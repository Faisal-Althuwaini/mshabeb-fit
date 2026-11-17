-- App-only sign-up (D29): anyone can start coaching from the PWA without Telegram.
-- Every table is keyed by users.telegram_user_id, so app-only users get a NEGATIVE id from a
-- sequence (real Telegram user ids are positive). The bot skips Telegram for them; nudges,
-- reports and milestones reach them by Web Push. Additive.
begin;

create sequence if not exists public.app_user_seq start 1000;
revoke all on sequence public.app_user_seq from public, anon, authenticated;

-- Start (or restart) coaching for the signed-in account. Creates the user row if needed.
-- Also works for a Telegram-linked account whose coach is off (replaces `/coach 90`).
create or replace function public.start_coach(p_name text, p_start numeric, p_goal numeric, p_minimum text default null)
returns bigint
language plpgsql volatile security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id bigint;
  v_name text := nullif(left(trim(coalesce(p_name, '')), 40), '');
  v_today date := (now() at time zone 'Asia/Riyadh')::date;
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if p_start is null or p_start < 30 or p_start > 300 then raise exception 'invalid start weight'; end if;
  if p_goal is null or p_goal < 30 or p_goal >= p_start then raise exception 'goal must be below the current weight'; end if;

  select telegram_user_id into v_id from public.users where auth_user_id = v_uid;
  if v_id is null then
    v_id := -nextval('public.app_user_seq');
    insert into public.users (telegram_user_id, first_name, auth_user_id) values (v_id, v_name, v_uid);
  end if;

  insert into public.coach_settings (user_id, coach_enabled, start_weight, goal_weight, coach_started_on, display_name, minimum_action)
  values (v_id, true, round(p_start, 1), round(p_goal, 1), v_today, v_name,
          coalesce(nullif(left(trim(coalesce(p_minimum, '')), 60), ''), 'مشي ١٥ دقيقة'))
  on conflict (user_id) do update set
    coach_enabled = true,
    start_weight = excluded.start_weight,
    goal_weight = excluded.goal_weight,
    coach_started_on = coalesce(public.coach_settings.coach_started_on, excluded.coach_started_on),
    display_name = coalesce(excluded.display_name, public.coach_settings.display_name),
    minimum_action = excluded.minimum_action,
    updated_at = now();

  insert into public.weight_entries (user_id, weight, recorded_at, source)
  values (v_id, round(p_start, 1), v_today, 'pwa')
  on conflict (user_id, recorded_at) do nothing;

  return v_id;
end;
$$;
revoke all on function public.start_coach(text, numeric, numeric, text) from public;
grant execute on function public.start_coach(text, numeric, numeric, text) to authenticated;

commit;
