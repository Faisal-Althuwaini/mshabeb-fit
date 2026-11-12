-- Mushabbab Coach — M1 migration (additive only). Run once in the Supabase SQL editor.
-- Safe to re-run: every statement is guarded with IF NOT EXISTS / ON CONFLICT / DROP POLICY IF EXISTS.
-- The bot uses the service role key, which bypasses RLS, so enabling RLS does not affect it.
-- See DECISIONS.md D4–D6.

begin;

-- ── Link users to Supabase Auth ────────────────────────────────────────────
alter table public.users
  add column if not exists auth_user_id uuid unique references auth.users(id) on delete set null;

-- Maps the logged-in auth user to their telegram_user_id (the key used by every table).
create or replace function public.coach_uid()
returns bigint
language sql stable security definer
set search_path = public
as $$
  select telegram_user_id from public.users where auth_user_id = auth.uid()
$$;
revoke all on function public.coach_uid() from public;
grant execute on function public.coach_uid() to authenticated;

-- ── weight_entries: extra columns ──────────────────────────────────────────
alter table public.weight_entries
  add column if not exists source text not null default 'telegram',
  add column if not exists note text;

do $$ begin
  alter table public.weight_entries
    add constraint weight_entries_source_check check (source in ('telegram','pwa'));
exception when duplicate_object then null; end $$;

-- ── coach_settings ─────────────────────────────────────────────────────────
-- One row per user. The coach is OPT-IN (DECISIONS.md D12): coach_enabled stays false until the
-- user sends /coach, and start/goal are set then. Users who never opt in keep the original bot.
create table if not exists public.coach_settings (
  user_id bigint primary key references public.users(telegram_user_id) on delete cascade,
  coach_enabled boolean not null default false,
  start_weight numeric(5,2),
  goal_weight  numeric(5,2),
  target_loss_per_4w numeric(4,2) not null default 3,
  ladder_step numeric(3,1) not null default 2,
  minimum_action text not null default 'مشي ١٥ دقيقة',
  lifting_days_required int not null default 2,
  week_start_dow int not null default 0,          -- 0 = Sunday (D2)
  timezone text not null default 'Asia/Riyadh',
  morning_check_time time not null default '11:00',
  evening_check_time time not null default '20:00',
  quiet_start time not null default '23:00',
  quiet_end   time not null default '08:00',
  weekly_report_dow int not null default 6,       -- 6 = Saturday
  weekly_report_time time not null default '21:00',
  paused_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coach_settings_enabled_needs_weights
    check (not coach_enabled or (start_weight is not null and goal_weight is not null))
);

-- Rows for existing users with the coach OFF; nothing changes for them.
insert into public.coach_settings (user_id)
select telegram_user_id from public.users
on conflict (user_id) do nothing;

-- ── daily_checks ───────────────────────────────────────────────────────────
create table if not exists public.daily_checks (
  user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  day date not null,                               -- local date in the user's timezone
  minimum_done boolean not null default false,
  lifted boolean not null default false,
  workout_label text,                              -- 'anterior' | 'posterior' | free text
  ate_out boolean,                                 -- v2, nullable
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

-- ── coach_messages ─────────────────────────────────────────────────────────
create table if not exists public.coach_messages (
  id bigserial primary key,
  user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  kind text not null check (kind in
    ('nudge_morning','nudge_firm','comeback','weekly_report','trend_alert',
     'milestone','lifting_check','chat_user','chat_coach')),
  local_date date,                                 -- for idempotency checks
  week_start date,
  content text not null,
  data jsonb,
  channels text[] not null default '{}',
  used_fallback boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_coach_messages_user_kind
  on public.coach_messages (user_id, kind, created_at desc);

-- ── push_subscriptions ─────────────────────────────────────────────────────
create table if not exists public.push_subscriptions (
  id bigserial primary key,
  user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  endpoint text unique not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now()
);

-- ── flex_photos (v1.5; storage bucket is created in M6) ────────────────────
create table if not exists public.flex_photos (
  id bigserial primary key,
  user_id bigint not null references public.users(telegram_user_id) on delete cascade,
  taken_on date not null,
  storage_path text not null,
  weight_at_time numeric(5,2),
  created_at timestamptz not null default now()
);

-- ── link_codes (D5) ────────────────────────────────────────────────────────
create table if not exists public.link_codes (
  code text primary key,
  auth_user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- Called by the PWA. Replaces any previous code for this auth user.
create or replace function public.create_link_code()
returns text
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  delete from public.link_codes where auth_user_id = auth.uid() or expires_at < now();
  loop
    v_code := lpad((floor(random() * 1000000))::int::text, 6, '0');
    begin
      insert into public.link_codes (code, auth_user_id, expires_at)
      values (v_code, auth.uid(), now() + interval '10 minutes');
      exit;
    exception when unique_violation then
      -- collision, try again
    end;
  end loop;
  return v_code;
end;
$$;
revoke all on function public.create_link_code() from public;
grant execute on function public.create_link_code() to authenticated;

-- ── RLS ────────────────────────────────────────────────────────────────────
alter table public.users              enable row level security;
alter table public.weight_entries     enable row level security;
alter table public.coach_settings     enable row level security;
alter table public.daily_checks       enable row level security;
alter table public.coach_messages     enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.flex_photos        enable row level security;
alter table public.link_codes         enable row level security;  -- no policies: RPC / service role only

-- users: the linked user can read their own row. Writes stay with the bot (service role),
-- so the PWA can never change telegram_user_id or auth_user_id.
drop policy if exists users_self_select on public.users;
create policy users_self_select on public.users
  for select to authenticated using (auth_user_id = auth.uid());

-- Owner-only CRUD for every user_id-keyed table.
do $$
declare t text;
begin
  foreach t in array array['weight_entries','coach_settings','daily_checks',
                           'coach_messages','push_subscriptions','flex_photos']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_owner', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = public.coach_uid())
         with check (user_id = public.coach_uid())',
      t || '_owner', t);
  end loop;
end $$;

commit;
