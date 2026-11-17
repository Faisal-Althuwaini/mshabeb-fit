-- Apple Health sync (D27): an iPhone Shortcut sends today's steps, strength-workout minutes and
-- last night's sleep to the `health-sync` edge function with a private per-user token.
-- Fitbit → Google Health → Apple Health (steps, sleep); Hevy → Apple Health (workouts). Additive.
begin;

alter table public.daily_checks
  add column if not exists steps int check (steps is null or steps between 0 and 150000),
  add column if not exists strength_minutes int check (strength_minutes is null or strength_minutes between 0 and 600),
  add column if not exists sleep_minutes int check (sleep_minutes is null or sleep_minutes between 0 and 1200),
  add column if not exists health_synced_at timestamptz;

-- The PWA reads daily_checks through a column grant (ate_out stays hidden, D14).
grant select (steps, strength_minutes, sleep_minutes, health_synced_at) on public.daily_checks to authenticated;

alter table public.coach_settings
  add column if not exists steps_goal int not null default 6000 check (steps_goal between 1000 and 50000),
  add column if not exists strength_min_minutes int not null default 20 check (strength_min_minutes between 5 and 180);

-- One private token per user; only its SHA-256 is stored.
create table if not exists public.health_tokens (
  user_id bigint primary key references public.users(telegram_user_id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
alter table public.health_tokens enable row level security;
drop policy if exists health_tokens_owner_read on public.health_tokens;
create policy health_tokens_owner_read on public.health_tokens for select to authenticated
  using (user_id = public.coach_uid());

-- Create (or rotate) the caller's token. Returns the plain token ONCE.
create or replace function public.create_health_token()
returns text
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_owner bigint := public.coach_uid();
  v_token text;
begin
  if v_owner is null then raise exception 'not linked'; end if;
  v_token := 'mh_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.health_tokens (user_id, token_hash, created_at, last_used_at)
  values (v_owner, encode(extensions.digest(v_token, 'sha256'), 'hex'), now(), null)
  on conflict (user_id) do update set token_hash = excluded.token_hash, created_at = now(), last_used_at = null;
  return v_token;
end;
$$;
revoke all on function public.create_health_token() from public;
grant execute on function public.create_health_token() to authenticated;

create or replace function public.revoke_health_token()
returns void
language sql volatile security definer
set search_path = public
as $$ delete from public.health_tokens where user_id = public.coach_uid() $$;
revoke all on function public.revoke_health_token() from public;
grant execute on function public.revoke_health_token() to authenticated;

-- get_bundle: checks carry the health fields; owner also gets sync status.
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
               from health_tokens h where h.user_id = p_owner)
  )
$$;

commit;
