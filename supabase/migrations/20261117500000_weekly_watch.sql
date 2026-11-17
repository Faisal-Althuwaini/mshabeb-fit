-- Weekly summary for watchers (D33): pg_cron asks the `notify` function every 30 min; it sends
-- once per owner per week (feed_events unique key) on the owner's report day after report time.
begin;

alter table public.feed_events drop constraint if exists feed_events_kind_check;
alter table public.feed_events add constraint feed_events_kind_check check (kind in ('missed_days','milestone','weekly_summary'));

create extension if not exists pg_cron;

do $$
begin
  perform cron.unschedule('weekly-watch') where exists (select 1 from cron.job where jobname = 'weekly-watch');
end $$;

select cron.schedule('weekly-watch', '*/30 * * * *', $job$
  select net.http_post(
    url := 'https://fdkieikygfcvqwbrtzdi.supabase.co/functions/v1/notify',
    body := '{"action":"weekly"}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json',
                                  'x-notify-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notify_secret')),
    timeout_milliseconds := 60000
  )
$job$);

commit;
