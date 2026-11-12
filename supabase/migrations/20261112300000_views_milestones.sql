-- «👀 شافه» seen marks + ladder milestone feed events (additive). Safe to re-run.
begin;

-- Who has seen which feed item. Written by watchers' apps, read by the owner.
create table if not exists public.feed_views (
  owner_user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  item_kind text not null check (item_kind in ('meal','flex','day','event')),
  item_ref text not null,
  viewer_auth_user_id uuid not null references auth.users(id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key (owner_user_id, item_kind, item_ref, viewer_auth_user_id)
);
alter table public.feed_views enable row level security;

drop policy if exists feed_views_read on public.feed_views;
create policy feed_views_read on public.feed_views for select to authenticated
  using (owner_user_id = public.coach_uid() or viewer_auth_user_id = auth.uid());
drop policy if exists feed_views_insert on public.feed_views;
create policy feed_views_insert on public.feed_views for insert to authenticated
  with check (viewer_auth_user_id = auth.uid() and public.can_view(owner_user_id) and owner_user_id <> coalesce(public.coach_uid(), -1));
drop policy if exists feed_views_update on public.feed_views;
create policy feed_views_update on public.feed_views for update to authenticated
  using (viewer_auth_user_id = auth.uid())
  with check (viewer_auth_user_id = auth.uid() and public.can_view(owner_user_id));

-- Milestones show up in the feed like the missed-days note.
alter table public.feed_events drop constraint if exists feed_events_kind_check;
alter table public.feed_events add constraint feed_events_kind_check check (kind in ('missed_days','milestone'));

commit;
