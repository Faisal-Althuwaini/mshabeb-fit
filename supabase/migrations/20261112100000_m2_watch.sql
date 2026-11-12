-- Mushabbab Coach — M2 / M2.5 migration (additive only). DECISIONS.md D13–D16.
-- Watchers, meal posts, flex sharing, reactions/comments, feed events, storage buckets, push for
-- auth users. Safe to re-run.

begin;

-- ── coach_settings: when the coach was switched on (anchors the 4-week target line) ──
alter table public.coach_settings add column if not exists coach_started_on date;
update public.coach_settings
   set coach_started_on = (now() at time zone 'Asia/Riyadh')::date
 where coach_enabled and coach_started_on is null;

-- ── Watchers ───────────────────────────────────────────────────────────────
create table if not exists public.watchers (
  owner_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  watcher_auth_user_id uuid not null references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  primary key (owner_user_id, watcher_auth_user_id)
);

create table if not exists public.watch_invites (
  code text primary key,
  owner_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- True for the owner themself or one of their watchers.
create or replace function public.can_view(p_owner bigint)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select p_owner = public.coach_uid()
      or exists (select 1 from public.watchers w
                  where w.owner_user_id = p_owner and w.watcher_auth_user_id = auth.uid())
$$;
revoke all on function public.can_view(bigint) from public;
grant execute on function public.can_view(bigint) to authenticated;

-- Owner (coach user) creates a 6-digit invite, valid 24 hours.
create or replace function public.create_watch_invite()
returns text
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_owner bigint := public.coach_uid();
  v_code text;
begin
  if v_owner is null then raise exception 'not linked'; end if;
  if not exists (select 1 from public.coach_settings where user_id = v_owner and coach_enabled) then
    raise exception 'coach not enabled';
  end if;
  delete from public.watch_invites where owner_user_id = v_owner or expires_at < now();
  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into public.watch_invites (code, owner_user_id, expires_at)
      values (v_code, v_owner, now() + interval '24 hours');
      exit;
    exception when unique_violation then end;
  end loop;
  return v_code;
end;
$$;
revoke all on function public.create_watch_invite() from public;
grant execute on function public.create_watch_invite() to authenticated;

-- Anyone logged in can accept an invite. Returns 'ok' | 'invalid' | 'expired' | 'self'.
create or replace function public.accept_watch_invite(p_code text, p_display_name text default null)
returns text
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_inv public.watch_invites%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_inv from public.watch_invites where code = p_code;
  if not found then return 'invalid'; end if;
  if v_inv.expires_at < now() then
    delete from public.watch_invites where code = p_code;
    return 'expired';
  end if;
  if v_inv.owner_user_id = public.coach_uid() then return 'self'; end if;
  insert into public.watchers (owner_user_id, watcher_auth_user_id, display_name)
  values (v_inv.owner_user_id, auth.uid(), nullif(left(trim(p_display_name), 40), ''))
  on conflict (owner_user_id, watcher_auth_user_id)
    do update set display_name = coalesce(excluded.display_name, public.watchers.display_name);
  delete from public.watch_invites where code = p_code;
  return 'ok';
end;
$$;
revoke all on function public.accept_watch_invite(text, text) from public;
grant execute on function public.accept_watch_invite(text, text) to authenticated;

-- Who am I? Used by the PWA to pick the owner or watcher experience.
create or replace function public.whoami()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'telegram_user_id', u.telegram_user_id,
    'first_name', u.first_name,
    'coach_enabled', coalesce(cs.coach_enabled, false),
    'watching', coalesce((
      select jsonb_agg(jsonb_build_object(
        'owner_user_id', w.owner_user_id,
        'first_name', ou.first_name,
        'start_weight', ocs.start_weight,
        'goal_weight', ocs.goal_weight,
        'ladder_step', ocs.ladder_step,
        'target_loss_per_4w', ocs.target_loss_per_4w,
        'week_start_dow', ocs.week_start_dow,
        'timezone', ocs.timezone,
        'coach_started_on', ocs.coach_started_on,
        'lifting_days_required', ocs.lifting_days_required,
        'minimum_action', ocs.minimum_action
      ) order by w.created_at)
      from public.watchers w
      join public.users ou on ou.telegram_user_id = w.owner_user_id
      left join public.coach_settings ocs on ocs.user_id = w.owner_user_id
      where w.watcher_auth_user_id = auth.uid()
    ), '[]'::jsonb)
  )
  from (select 1) one
  left join public.users u on u.auth_user_id = auth.uid()
  left join public.coach_settings cs on cs.user_id = u.telegram_user_id
$$;
revoke all on function public.whoami() from public;
grant execute on function public.whoami() to authenticated;

-- ── Meal posts ─────────────────────────────────────────────────────────────
create table if not exists public.meal_posts (
  id bigserial primary key,
  user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  local_date date not null,
  posted_at timestamptz not null default now(),
  storage_path text not null,
  caption text check (caption is null or length(caption) <= 500),
  source text not null default 'pwa' check (source in ('telegram','pwa'))
);
create index if not exists idx_meal_posts_user_date on public.meal_posts (user_id, local_date desc);

-- ── Flex: per-photo sharing (D15) ──────────────────────────────────────────
alter table public.flex_photos
  add column if not exists shared_with_watchers boolean not null default false,
  add column if not exists caption text,
  add column if not exists is_comparison boolean not null default false;

-- ── Feed events (e.g. "quiet for 3 days") ─────────────────────────────────
create table if not exists public.feed_events (
  id bigserial primary key,
  owner_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  kind text not null check (kind in ('missed_days')),
  local_date date not null,
  gap_key text not null,                         -- e.g. last active day; one event per gap
  data jsonb,
  created_at timestamptz not null default now(),
  unique (owner_user_id, kind, gap_key)
);

-- ── Reactions & comments (D16) ─────────────────────────────────────────────
create table if not exists public.feed_reactions (
  owner_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  item_kind text not null check (item_kind in ('meal','flex','day')),
  item_ref text not null,
  author_auth_user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (emoji in ('🔥','💪','👏','😅','👀')),
  created_at timestamptz not null default now(),
  notified_at timestamptz,
  primary key (owner_user_id, item_kind, item_ref, author_auth_user_id)
);

create table if not exists public.feed_comments (
  id bigserial primary key,
  owner_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  item_kind text not null check (item_kind in ('meal','flex','day')),
  item_ref text not null,
  author_auth_user_id uuid not null references auth.users(id) on delete cascade,
  author_name text,
  body text not null check (length(body) between 1 and 280),
  created_at timestamptz not null default now(),
  notified_at timestamptz
);
create index if not exists idx_feed_comments_item on public.feed_comments (owner_user_id, item_kind, item_ref);
create index if not exists idx_feed_comments_unnotified on public.feed_comments (created_at) where notified_at is null;
create index if not exists idx_feed_reactions_unnotified on public.feed_reactions (created_at) where notified_at is null;

-- ── Push subscriptions for any logged-in user (watchers have no Telegram id) ──
alter table public.push_subscriptions add column if not exists auth_user_id uuid references auth.users(id) on delete cascade;
alter table public.push_subscriptions alter column user_id drop not null;

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.watchers       enable row level security;
alter table public.watch_invites  enable row level security;   -- RPC only
alter table public.meal_posts     enable row level security;
alter table public.feed_events    enable row level security;
alter table public.feed_reactions enable row level security;
alter table public.feed_comments  enable row level security;

-- watchers: owner sees and removes their watchers; a watcher sees and removes their own row.
drop policy if exists watchers_select on public.watchers;
create policy watchers_select on public.watchers for select to authenticated
  using (owner_user_id = public.coach_uid() or watcher_auth_user_id = auth.uid());
drop policy if exists watchers_delete on public.watchers;
create policy watchers_delete on public.watchers for delete to authenticated
  using (owner_user_id = public.coach_uid() or watcher_auth_user_id = auth.uid());

-- Watchers get READ access to the owner's weights and checks (owner policies from M1 stay).
drop policy if exists weight_entries_watch on public.weight_entries;
create policy weight_entries_watch on public.weight_entries for select to authenticated
  using (public.can_view(user_id));
drop policy if exists daily_checks_watch on public.daily_checks;
create policy daily_checks_watch on public.daily_checks for select to authenticated
  using (public.can_view(user_id));
-- Hide ate_out from the PWA entirely (D14): column-level select grant.
revoke select on public.daily_checks from authenticated;
grant select (user_id, day, minimum_done, lifted, workout_label, updated_at) on public.daily_checks to authenticated;

-- meal_posts: owner full; watchers read.
drop policy if exists meal_posts_owner on public.meal_posts;
create policy meal_posts_owner on public.meal_posts for all to authenticated
  using (user_id = public.coach_uid()) with check (user_id = public.coach_uid());
drop policy if exists meal_posts_watch on public.meal_posts;
create policy meal_posts_watch on public.meal_posts for select to authenticated
  using (public.can_view(user_id));

-- flex_photos: owner policy from M1; watchers read only shared ones.
drop policy if exists flex_photos_watch on public.flex_photos;
create policy flex_photos_watch on public.flex_photos for select to authenticated
  using (shared_with_watchers and public.can_view(user_id));

-- feed_events: read for owner + watchers; written by the bot (service role).
drop policy if exists feed_events_read on public.feed_events;
create policy feed_events_read on public.feed_events for select to authenticated
  using (public.can_view(owner_user_id));

-- reactions: read for owner + watchers; write own reaction only.
drop policy if exists feed_reactions_read on public.feed_reactions;
create policy feed_reactions_read on public.feed_reactions for select to authenticated
  using (public.can_view(owner_user_id));
drop policy if exists feed_reactions_insert on public.feed_reactions;
create policy feed_reactions_insert on public.feed_reactions for insert to authenticated
  with check (author_auth_user_id = auth.uid() and public.can_view(owner_user_id) and notified_at is null);
drop policy if exists feed_reactions_update on public.feed_reactions;
create policy feed_reactions_update on public.feed_reactions for update to authenticated
  using (author_auth_user_id = auth.uid())
  with check (author_auth_user_id = auth.uid() and public.can_view(owner_user_id));
drop policy if exists feed_reactions_delete on public.feed_reactions;
create policy feed_reactions_delete on public.feed_reactions for delete to authenticated
  using (author_auth_user_id = auth.uid());

-- comments: read for owner + watchers; write own; delete own, or any on your own feed.
drop policy if exists feed_comments_read on public.feed_comments;
create policy feed_comments_read on public.feed_comments for select to authenticated
  using (public.can_view(owner_user_id));
drop policy if exists feed_comments_insert on public.feed_comments;
create policy feed_comments_insert on public.feed_comments for insert to authenticated
  with check (author_auth_user_id = auth.uid() and public.can_view(owner_user_id) and notified_at is null);
drop policy if exists feed_comments_delete on public.feed_comments;
create policy feed_comments_delete on public.feed_comments for delete to authenticated
  using (author_auth_user_id = auth.uid() or owner_user_id = public.coach_uid());

-- push_subscriptions: keyed by auth user now.
drop policy if exists push_subscriptions_owner on public.push_subscriptions;
drop policy if exists push_subscriptions_self on public.push_subscriptions;
create policy push_subscriptions_self on public.push_subscriptions for all to authenticated
  using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

-- ── Storage: private buckets ───────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('meal-photos', 'meal-photos', false, 5242880, array['image/jpeg','image/png','image/webp']),
       ('flex-photos', 'flex-photos', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

-- Path layout: {telegram_user_id}/{yyyy-mm-dd}/{uuid}.jpg
drop policy if exists photos_owner_write on storage.objects;
create policy photos_owner_write on storage.objects for insert to authenticated
  with check (bucket_id in ('meal-photos','flex-photos')
              and (storage.foldername(name))[1] = public.coach_uid()::text);
drop policy if exists photos_owner_modify on storage.objects;
create policy photos_owner_modify on storage.objects for update to authenticated
  using (bucket_id in ('meal-photos','flex-photos')
         and (storage.foldername(name))[1] = public.coach_uid()::text);
drop policy if exists photos_owner_delete on storage.objects;
create policy photos_owner_delete on storage.objects for delete to authenticated
  using (bucket_id in ('meal-photos','flex-photos')
         and (storage.foldername(name))[1] = public.coach_uid()::text);

drop policy if exists meal_photos_read on storage.objects;
create policy meal_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'meal-photos'
         and (storage.foldername(name))[1] ~ '^[0-9]+$'
         and public.can_view(((storage.foldername(name))[1])::bigint));

drop policy if exists flex_photos_read on storage.objects;
create policy flex_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'flex-photos'
         and ((storage.foldername(name))[1] = public.coach_uid()::text
              or exists (select 1 from public.flex_photos f
                          where f.storage_path = name and f.shared_with_watchers
                            and public.can_view(f.user_id))));

commit;
