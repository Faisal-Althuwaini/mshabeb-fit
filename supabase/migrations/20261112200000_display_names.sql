-- Display names (additive). The owner's name used to be users.first_name, which the bot
-- overwrites from Telegram on every message, so the app gets its own editable name.
-- Watchers rename themselves through an RPC (a direct UPDATE policy would let them change
-- owner_user_id and follow someone else). Safe to re-run.

begin;

alter table public.coach_settings
  add column if not exists display_name text check (display_name is null or length(trim(display_name)) between 1 and 40);

-- Watcher renames their own watcher rows (all owners they follow).
create or replace function public.set_watcher_name(p_name text)
returns void
language plpgsql volatile security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if p_name is null or length(trim(p_name)) not between 1 and 40 then raise exception 'name must be 1-40 characters'; end if;
  update public.watchers set display_name = trim(p_name) where watcher_auth_user_id = auth.uid();
end;
$$;
revoke all on function public.set_watcher_name(text) from public;
grant execute on function public.set_watcher_name(text) to authenticated;

-- whoami: prefer the app display name over the Telegram name; also return my watcher name.
create or replace function public.whoami()
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'telegram_user_id', u.telegram_user_id,
    'first_name', coalesce(cs.display_name, u.first_name),
    'display_name', cs.display_name,
    'telegram_name', u.first_name,
    'coach_enabled', coalesce(cs.coach_enabled, false),
    'my_watcher_name', (select w.display_name from public.watchers w where w.watcher_auth_user_id = auth.uid() order by w.created_at limit 1),
    'watching', coalesce((
      select jsonb_agg(jsonb_build_object(
        'owner_user_id', w.owner_user_id,
        'first_name', coalesce(ocs.display_name, ou.first_name),
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

commit;
