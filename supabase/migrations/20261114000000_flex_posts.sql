-- Flex v2 (D24): a flex POST groups up to 4 photos (front/side/back…), with the weight at the time
-- and optional body measurements. Additive; existing single photos are wrapped in posts. Safe to re-run.
begin;

create table if not exists public.flex_posts (
  id bigserial primary key,
  user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  taken_on date not null,
  weight numeric(5,2) check (weight is null or weight between 20 and 300),
  caption text check (caption is null or length(caption) <= 500),
  shared_with_watchers boolean not null default false,
  is_comparison boolean not null default false,
  tg_media_group text,                       -- Telegram album id (bot groups album photos into one post)
  created_at timestamptz not null default now()
);
create index if not exists idx_flex_posts_user_date on public.flex_posts (user_id, taken_on desc);

alter table public.flex_photos
  add column if not exists post_id bigint references public.flex_posts(id) on delete cascade,
  add column if not exists position smallint not null default 0;

-- Wrap any legacy single photos in their own post.
do $$
declare r record; pid bigint;
begin
  for r in select * from public.flex_photos where post_id is null loop
    insert into public.flex_posts (user_id, taken_on, weight, caption, shared_with_watchers, is_comparison, created_at)
    values (r.user_id, r.taken_on, r.weight_at_time, r.caption, r.shared_with_watchers, r.is_comparison, r.created_at)
    returning id into pid;
    update public.flex_photos set post_id = pid, position = 0 where id = r.id;
  end loop;
end $$;

-- At most 4 photos per post.
create or replace function public.flex_photos_limit() returns trigger
language plpgsql as $$
begin
  if new.post_id is not null and (select count(*) from public.flex_photos where post_id = new.post_id) >= 4 then
    raise exception 'a flex post has at most 4 photos';
  end if;
  return new;
end $$;
drop trigger if exists flex_photos_limit on public.flex_photos;
create trigger flex_photos_limit before insert on public.flex_photos for each row execute function public.flex_photos_limit();

-- Body measurements: one row per day, all optional, OWNER ONLY (never shown to watchers).
create table if not exists public.body_measurements (
  user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  day date not null,
  waist_cm numeric(5,1) check (waist_cm is null or waist_cm between 30 and 250),
  chest_cm numeric(5,1) check (chest_cm is null or chest_cm between 30 and 250),
  hips_cm  numeric(5,1) check (hips_cm  is null or hips_cm  between 30 and 250),
  arm_cm   numeric(5,1) check (arm_cm   is null or arm_cm   between 10 and 100),
  thigh_cm numeric(5,1) check (thigh_cm is null or thigh_cm between 20 and 150),
  neck_cm  numeric(5,1) check (neck_cm  is null or neck_cm  between 20 and 80),
  body_fat_pct numeric(4,1) check (body_fat_pct is null or body_fat_pct between 2 and 70),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- RLS
alter table public.flex_posts enable row level security;
alter table public.body_measurements enable row level security;

drop policy if exists flex_posts_owner on public.flex_posts;
create policy flex_posts_owner on public.flex_posts for all to authenticated
  using (user_id = public.coach_uid()) with check (user_id = public.coach_uid());
drop policy if exists flex_posts_watch on public.flex_posts;
create policy flex_posts_watch on public.flex_posts for select to authenticated
  using (shared_with_watchers and public.can_view(user_id));

drop policy if exists body_measurements_owner on public.body_measurements;
create policy body_measurements_owner on public.body_measurements for all to authenticated
  using (user_id = public.coach_uid()) with check (user_id = public.coach_uid());

-- Sharing a post shares its photos (the storage read policy checks flex_photos.shared_with_watchers).
create or replace function public.flex_posts_sync_share() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.shared_with_watchers is distinct from old.shared_with_watchers then
    update public.flex_photos set shared_with_watchers = new.shared_with_watchers where post_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists flex_posts_sync_share on public.flex_posts;
create trigger flex_posts_sync_share after update on public.flex_posts for each row execute function public.flex_posts_sync_share();

-- get_bundle: add posts + measurements (RLS decides: watchers get shared posts, never measurements).
create or replace function public.get_bundle(p_owner bigint)
returns jsonb
language sql stable security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'entries', coalesce((select jsonb_agg(jsonb_build_object('date', w.recorded_at, 'weight', w.weight) order by w.recorded_at)
                         from weight_entries w where w.user_id = p_owner), '[]'::jsonb),
    'checks', coalesce((select jsonb_agg(jsonb_build_object('day', c.day, 'minimum_done', c.minimum_done, 'lifted', c.lifted, 'workout_label', c.workout_label) order by c.day)
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
    'watchers', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at) from watchers w where w.owner_user_id = p_owner), '[]'::jsonb)
  )
$$;

commit;
