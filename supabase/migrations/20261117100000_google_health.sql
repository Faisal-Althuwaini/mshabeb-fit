-- Google Health API (D28): the owner links their Google account once (OAuth), then the
-- `google-health` edge function pulls steps and sleep (Fitbit → Google Health) every 20 min.
-- The refresh token is never readable by clients (column grants). Additive.
begin;

create table if not exists public.google_health_links (
  user_id bigint primary key references public.users(telegram_user_id) on delete cascade,
  refresh_token text not null,
  scopes text,
  created_at timestamptz not null default now(),
  last_sync_at timestamptz,
  last_error text
);
alter table public.google_health_links enable row level security;
revoke all on public.google_health_links from anon, authenticated;
grant select (user_id, created_at, last_sync_at, last_error) on public.google_health_links to authenticated;
drop policy if exists google_health_owner_read on public.google_health_links;
create policy google_health_owner_read on public.google_health_links for select to authenticated
  using (user_id = public.coach_uid());

-- One-time OAuth `state` values (CSRF + which user is linking). Service role only.
create table if not exists public.google_oauth_states (
  state text primary key,
  user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes'
);
alter table public.google_oauth_states enable row level security;
revoke all on public.google_oauth_states from anon, authenticated;

create or replace function public.create_google_state()
returns text
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_owner bigint := public.coach_uid();
  v_state text;
begin
  if v_owner is null then raise exception 'not linked'; end if;
  delete from public.google_oauth_states where expires_at < now();
  v_state := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.google_oauth_states (state, user_id) values (v_state, v_owner);
  return v_state;
end;
$$;
revoke all on function public.create_google_state() from public;
grant execute on function public.create_google_state() to authenticated;

create or replace function public.disconnect_google_health()
returns void
language sql volatile security definer
set search_path = public
as $$ delete from public.google_health_links where user_id = public.coach_uid() $$;
revoke all on function public.disconnect_google_health() from public;
grant execute on function public.disconnect_google_health() to authenticated;

-- get_bundle: + `google` status (owner only, via RLS).
create or replace function public.get_bundle(p_owner bigint)
returns jsonb
language sql stable security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'entries', coalesce((select jsonb_agg(jsonb_build_object('date', w.recorded_at, 'weight', w.weight) order by w.recorded_at)
                         from weight_entries w where w.user_id = p_owner), '[]'::jsonb),
    'checks', coalesce((select jsonb_agg(jsonb_build_object('day', c.day, 'minimum_done', c.minimum_done, 'lifted', c.lifted, 'workout_label', c.workout_label,
                          'steps', c.steps, 'strength_minutes', c.strength_minutes, 'sleep_minutes', c.sleep_minutes, 'health_synced_at', c.health_synced_at) order by c.day)
                        from daily_checks c where c.user_id = p_owner), '[]'::jsonb),
    'meals', coalesce((select jsonb_agg(to_jsonb(m) order by m.posted_at desc)
                       from (select * from meal_posts where user_id = p_owner order by posted_at desc limit 300) m), '[]'::jsonb),
    'flex', coalesce((select jsonb_agg(to_jsonb(f) order by f.taken_on desc, f.position) from flex_photos f where f.user_id = p_owner), '[]'::jsonb),
    'flex_posts', coalesce((select jsonb_agg(to_jsonb(p) order by p.taken_on desc, p.created_at desc) from flex_posts p where p.user_id = p_owner), '[]'::jsonb),
    'measurements', coalesce((select jsonb_agg(to_jsonb(b) order by b.day) from body_measurements b where b.user_id = p_owner), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at desc)
                        from (select * from feed_events where owner_user_id = p_owner order by created_at desc limit 50) e), '[]'::jsonb),
    'reactions', coalesce((select jsonb_agg(jsonb_build_object('owner_user_id', r.owner_user_id, 'item_kind', r.item_kind, 'item_ref', r.item_ref,
                             'author_auth_user_id', r.author_auth_user_id, 'emoji', r.emoji, 'created_at', r.created_at))
                           from feed_reactions r where r.owner_user_id = p_owner), '[]'::jsonb),
    'comments', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'owner_user_id', c.owner_user_id, 'item_kind', c.item_kind, 'item_ref', c.item_ref,
                            'author_auth_user_id', c.author_auth_user_id, 'author_name', c.author_name, 'body', c.body, 'created_at', c.created_at) order by c.created_at)
                          from feed_comments c where c.owner_user_id = p_owner), '[]'::jsonb),
    'views', coalesce((select jsonb_agg(to_jsonb(v)) from feed_views v where v.owner_user_id = p_owner), '[]'::jsonb),
    'watchers', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at) from watchers w where w.owner_user_id = p_owner), '[]'::jsonb),
    'health', (select jsonb_build_object('connected', true, 'last_used_at', h.last_used_at, 'created_at', h.created_at)
               from health_tokens h where h.user_id = p_owner),
    'google', (select jsonb_build_object('connected', true, 'created_at', g.created_at, 'last_sync_at', g.last_sync_at, 'last_error', g.last_error)
               from google_health_links g where g.user_id = p_owner)
  )
$$;

commit;
