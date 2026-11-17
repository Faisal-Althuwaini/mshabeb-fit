-- Instant notifications (D32): database triggers call the `notify` edge function through pg_net
-- instead of the bot polling every minute. One queued job per owner (notify_pending, due 20 s
-- later) so quick posts batch into one push. The shared secret lives in Vault and is never
-- returned to anyone: the function checks it with notify_secret_ok (service role only).
begin;

create extension if not exists pg_net with schema extensions;

create table if not exists public.notify_pending (
  owner_user_id bigint primary key,
  due_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.notify_pending enable row level security;
revoke all on public.notify_pending from anon, authenticated;

-- Secret: created once, inside the database.
do $$
begin
  if not exists (select 1 from vault.secrets where name = 'notify_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'notify_secret', 'notify edge function auth');
  end if;
end $$;

create or replace function public.notify_secret_ok(p_secret text)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select coalesce(p_secret <> '' and p_secret = (select decrypted_secret from vault.decrypted_secrets where name = 'notify_secret'), false)
$$;
revoke all on function public.notify_secret_ok(text) from public, anon, authenticated;
grant execute on function public.notify_secret_ok(text) to service_role;

-- Queue a run for this owner unless one is already waiting (a stuck job older than 2 min is replaced).
create or replace function public.queue_notify(p_owner bigint)
returns void
language plpgsql volatile security definer
set search_path = public, extensions
as $$
declare
  v_queued int;
begin
  delete from public.notify_pending where owner_user_id = p_owner and created_at < now() - interval '2 minutes';
  insert into public.notify_pending (owner_user_id, due_at) values (p_owner, now() + interval '20 seconds')
  on conflict (owner_user_id) do nothing;
  get diagnostics v_queued = row_count;
  if v_queued = 1 then
    perform net.http_post(
      url := 'https://fdkieikygfcvqwbrtzdi.supabase.co/functions/v1/notify',
      body := jsonb_build_object('owner_user_id', p_owner),
      headers := jsonb_build_object('Content-Type', 'application/json',
                                    'x-notify-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notify_secret')),
      timeout_milliseconds := 60000
    );
  end if;
exception when others then
  raise warning 'queue_notify failed: %', sqlerrm; -- never block the user's write
end;
$$;
revoke all on function public.queue_notify(bigint) from public, anon, authenticated;

create or replace function public.trg_queue_notify()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  v_owner bigint;
begin
  if tg_table_name in ('feed_comments', 'feed_reactions') then
    v_owner := new.owner_user_id;
  else
    v_owner := new.user_id;
    -- Posts only matter if someone watches.
    if not exists (select 1 from public.watchers where owner_user_id = v_owner) then return new; end if;
  end if;
  if tg_table_name = 'flex_posts' and not (new.shared_with_watchers and new.notified_at is null) then return new; end if;
  perform public.queue_notify(v_owner);
  return new;
end;
$$;

drop trigger if exists queue_notify on public.feed_comments;
create trigger queue_notify after insert on public.feed_comments for each row execute function public.trg_queue_notify();
drop trigger if exists queue_notify on public.feed_reactions;
create trigger queue_notify after insert on public.feed_reactions for each row execute function public.trg_queue_notify();
drop trigger if exists queue_notify on public.meal_posts;
create trigger queue_notify after insert on public.meal_posts for each row execute function public.trg_queue_notify();
drop trigger if exists queue_notify on public.weight_entries;
create trigger queue_notify after insert on public.weight_entries for each row execute function public.trg_queue_notify();
drop trigger if exists queue_notify on public.flex_posts;
create trigger queue_notify after insert or update of shared_with_watchers on public.flex_posts for each row execute function public.trg_queue_notify();

commit;
