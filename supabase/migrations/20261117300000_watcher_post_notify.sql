-- Watchers get a push when the owner posts a meal, shares a Flex post, or logs the day's
-- weight (D31). The bot's notifier picks up rows with notified_at null, sends one batched
-- push per owner, and stamps them. Existing rows are stamped now so nothing old is sent.
begin;

alter table public.meal_posts     add column if not exists notified_at timestamptz;
alter table public.flex_posts     add column if not exists notified_at timestamptz;
alter table public.weight_entries add column if not exists notified_at timestamptz;

update public.meal_posts     set notified_at = now() where notified_at is null;
update public.flex_posts     set notified_at = now() where notified_at is null;
update public.weight_entries set notified_at = now() where notified_at is null;

create index if not exists idx_meal_posts_unnotified     on public.meal_posts (posted_at)  where notified_at is null;
create index if not exists idx_flex_posts_unnotified     on public.flex_posts (created_at) where notified_at is null;
create index if not exists idx_weight_entries_unnotified on public.weight_entries (created_at) where notified_at is null;

commit;
