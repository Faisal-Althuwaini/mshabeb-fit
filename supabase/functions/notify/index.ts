// notify (D32): instant watcher/owner pushes, called by database triggers through pg_net.
// A trigger on comments, reactions, meals, shared Flex posts and weights queues one job per owner
// (table notify_pending, due 20 s later) and POSTs {owner_user_id} here. We wait until it's due so
// quick posts batch into one push, clear the job, CLAIM unnotified rows (update … returning, so two
// runs never send the same thing), then push. Auth: the shared secret stored in Vault, checked by
// the service-role-only RPC notify_secret_ok. Deploy with --no-verify-jwt.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import webpush from 'npm:web-push@3.6.7';
import * as S from '../_shared/stats.mjs';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY') || '';
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY') || '';
if (VAPID_PUBLIC && VAPID_PRIVATE) webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@example.com', VAPID_PUBLIC, VAPID_PRIVATE);

const STALE_MS = 12 * 60 * 60 * 1000;
const ITEM_AR: Record<string, string> = { meal: 'وجبتك', day: 'يومك', flex: 'صورتك' };
const ar = (n: number) => S.toArabicDigits(n);
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
const itemUrl = (kind: string, ref: string) => `/feed?item=${encodeURIComponent(`${kind}:${ref}`)}`;

type Owner = { id: string; authId: string | null; name: string; watchers: { authId: string; name: string | null }[] };
type Payload = { title: string; body: string; url?: string; tag?: string };

async function sendTo(authIds: (string | null)[], payload: Payload) {
  const ids = [...new Set(authIds.filter(Boolean))] as string[];
  if (!ids.length || !VAPID_PUBLIC) return 0;
  const { data: subs } = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').in('auth_user_id', ids);
  const body = JSON.stringify({ url: '/', ...payload });
  let ok = 0;
  await Promise.all((subs || []).map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 86400 });
      ok++;
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.from('push_subscriptions').delete().eq('id', s.id);
      else console.error('push error', code, (e as Error).message);
    }
  }));
  return ok;
}

async function loadOwner(ownerId: string): Promise<Owner | null> {
  const [{ data: u }, { data: cs }, { data: w }] = await Promise.all([
    db.from('users').select('auth_user_id, first_name').eq('telegram_user_id', ownerId).maybeSingle(),
    db.from('coach_settings').select('display_name').eq('user_id', ownerId).maybeSingle(),
    db.from('watchers').select('watcher_auth_user_id, display_name').eq('owner_user_id', ownerId),
  ]);
  if (!u) return null;
  return {
    id: ownerId,
    authId: u.auth_user_id,
    name: cs?.display_name || (u.first_name || '').split(' ')[0] || 'صاحبك',
    watchers: (w || []).map((x) => ({ authId: x.watcher_auth_user_id, name: x.display_name })),
  };
}

/** Who hears about something written on owner's feed: the owner's own words go to watchers, a watcher's go to the owner. */
const recipientsFor = (o: Owner, author: string | null) =>
  author && author === o.authId ? o.watchers.map((w) => w.authId).filter((id) => id !== author) : o.authId ? [o.authId] : [];
const authorName = (o: Owner, author: string | null, fallback?: string | null) =>
  author === o.authId ? o.name : fallback || o.watchers.find((w) => w.authId === author)?.name || 'صاحبك';

async function comments(o: Owner) {
  const { data } = await db.from('feed_comments').update({ notified_at: new Date().toISOString() })
    .eq('owner_user_id', o.id).is('notified_at', null)
    .select('id, item_kind, item_ref, author_auth_user_id, author_name, body');
  for (const c of data || []) {
    const name = authorName(o, c.author_auth_user_id, c.author_name);
    const title = c.author_auth_user_id === o.authId ? `${name} رد عليك` : `${name} علّق على ${ITEM_AR[c.item_kind] || 'منشورك'}`;
    await sendTo(recipientsFor(o, c.author_auth_user_id), { title, body: String(c.body).slice(0, 140), url: itemUrl(c.item_kind, c.item_ref), tag: `comment-${c.id}` });
  }
  return data?.length || 0;
}

async function reactions(o: Owner) {
  const { data } = await db.from('feed_reactions').update({ notified_at: new Date().toISOString() })
    .eq('owner_user_id', o.id).is('notified_at', null)
    .select('item_kind, item_ref, author_auth_user_id, emoji');
  // Reactions by the owner on their own feed stay silent; watchers' reactions go to the owner.
  const list = (data || []).filter((r) => r.author_auth_user_id !== o.authId);
  if (!list.length || !o.authId) return 0;
  const emojis = [...new Set(list.map((r) => r.emoji))].join('');
  const one = list.length === 1;
  await sendTo([o.authId], {
    title: one ? `${authorName(o, list[0].author_auth_user_id)} حط ${list[0].emoji} على ${ITEM_AR[list[0].item_kind] || 'منشورك'}` : `${ar(list.length)} تفاعلات جديدة ${emojis}`,
    body: 'افتح المتابعة',
    url: one ? itemUrl(list[0].item_kind, list[0].item_ref) : '/feed',
    tag: 'reactions',
  });
  return list.length;
}

function postsMessage(name: string, meals: number, flex: number, weight: number | null): Payload | null {
  const parts: string[] = [];
  if (weight != null) parts.push(`وزنه ${ar(weight)} كغ ⚖️`);
  if (meals) parts.push(meals === 1 ? 'وجبة 🍽️' : meals === 2 ? 'وجبتين 🍽️' : `${ar(meals)} وجبات 🍽️`);
  if (flex) parts.push(flex === 1 ? 'فليكس 💪' : `${ar(flex)} فليكس 💪`);
  if (!parts.length) return null;
  const only = parts.length === 1;
  const title = !only ? `${name} نزّل جديد`
    : weight != null ? `${name} سجّل وزنه: ${ar(weight)} كغ ⚖️`
    : meals ? (meals === 1 ? `${name} نزّل وجبة 🍽️` : `${name} نزّل ${parts[0]}`)
    : `${name} شارك فليكس 💪`;
  return { title, body: only ? 'افتح وشوف 👀' : parts.join(' · '), url: only && weight != null ? '/progress' : '/feed' };
}

async function posts(o: Owner) {
  const now = new Date().toISOString();
  const [m, f, w] = await Promise.all([
    db.from('meal_posts').update({ notified_at: now }).eq('user_id', o.id).is('notified_at', null).select('posted_at'),
    // Private Flex posts aren't claimed: they're announced if shared later.
    db.from('flex_posts').update({ notified_at: now }).eq('user_id', o.id).is('notified_at', null).eq('shared_with_watchers', true).select('created_at'),
    db.from('weight_entries').update({ notified_at: now }).eq('user_id', o.id).is('notified_at', null).select('weight, recorded_at, created_at'),
  ]);
  if (!o.watchers.length) return 0;
  const fresh = (t: string) => Date.now() - Date.parse(t) < STALE_MS;
  const meals = (m.data || []).filter((r) => fresh(r.posted_at)).length;
  const flex = (f.data || []).filter((r) => fresh(r.created_at)).length;
  const latest = (w.data || []).filter((r) => fresh(r.created_at)).sort((a, z) => z.recorded_at.localeCompare(a.recorded_at))[0];
  const msg = postsMessage(o.name, meals, flex, latest ? Number(latest.weight) : null);
  if (!msg) return 0;
  return sendTo(o.watchers.map((x) => x.authId), { ...msg, tag: `posts-${o.id}` });
}

// ── Weekly summary for watchers (D33) ───────────────────────────────────────────────
// pg_cron POSTs {action:'weekly'} every 30 min. On the owner's report day, after the report
// time (default Saturday 21:00, their timezone), each watcher gets one push and the feed gets a
// «ملخص الأسبوع» card. The feed_events unique key (owner, kind, week) makes it once per week.

const toMin = (t: string | null | undefined) => { const [h, m] = String(t || '21:00').split(':').map(Number); return h * 60 + (m || 0); };
const verb = (change: number) => (change < 0 ? `نزل ${ar(Math.abs(change))} كيلو` : change > 0 ? `زاد ${ar(change)} كيلو` : 'ثابت');

async function weeklyFor(ownerId: string, now: Date, preview = false) {
  const { data: st } = await db.from('coach_settings').select('*').eq('user_id', ownerId).maybeSingle();
  if (!st?.coach_enabled) return 'coach off';
  const tz = st.timezone || 'Asia/Riyadh';
  const today = S.localDate(now, tz);
  if (!preview && S.dayOfWeek(today) !== (st.weekly_report_dow ?? 6)) return 'not today';
  if (!preview && S.localMinutes(now, tz) < toMin(st.weekly_report_time)) return 'too early';
  if (st.paused_until && st.paused_until >= today) return 'paused';

  const [{ data: e }, { data: c }] = await Promise.all([
    db.from('weight_entries').select('weight, recorded_at').eq('user_id', ownerId),
    db.from('daily_checks').select('day, minimum_done, lifted, workout_label, steps, sleep_minutes, strength_minutes').eq('user_id', ownerId),
  ]);
  const entries = (e || []).map((r) => ({ date: r.recorded_at, weight: Number(r.weight) }));
  const checks = c || [];
  const snap = S.buildSnapshot({ entries, checks, settings: st, today });
  const w = snap.thisWeek;
  const weekDays = new Set(Array.from({ length: 7 }, (_, i) => S.addDays(w.week_start, i)));
  const wk = checks.filter((x) => weekDays.has(x.day));
  const avgOf = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const data = {
    week_start: w.week_start,
    avg: w.avg_weight, change: snap.weekChange, weighins: w.n_weighins,
    minimum_days: w.minimum_days, lifting_days: w.lifting_days, lifting_required: st.lifting_days_required ?? 2,
    steps_avg: avgOf(wk.map((x) => x.steps).filter((n): n is number => typeof n === 'number' && n > 0)),
    sleep_avg: avgOf(wk.map((x) => x.sleep_minutes).filter((n): n is number => typeof n === 'number' && n > 0)),
    streak: snap.streak, next_step: snap.ladder?.next ?? null, remaining: snap.ladder?.remaining_to_next ?? null,
  };
  if (!w.n_weighins && !w.minimum_days && !w.lifting_days) return 'empty week';

  const o = await loadOwner(ownerId);
  const parts: string[] = [];
  if (data.change != null) parts.push(verb(data.change));
  else if (data.avg != null) parts.push(`متوسطه ${ar(data.avg)}`);
  parts.push(`أقل شي ${ar(data.minimum_days)} من ٧`);
  parts.push(`حديد ${ar(data.lifting_days)}`);
  if (data.steps_avg) parts.push(`${data.steps_avg.toLocaleString('ar-SA')} خطوة باليوم`);
  const good = (data.change ?? 0) <= 0 && data.minimum_days >= 4;
  const title = `${o?.name ?? 'صاحبك'} هالأسبوع ${good ? '💪' : '📊'}`;
  if (preview) return `${title} | ${parts.join(' · ')}`;
  const { data: ins } = await db.from('feed_events').upsert(
    { owner_user_id: ownerId, kind: 'weekly_summary', local_date: today, gap_key: w.week_start, data },
    { onConflict: 'owner_user_id,kind,gap_key', ignoreDuplicates: true },
  ).select('id');
  if (!ins?.length) return 'already sent';

  if (!o?.watchers.length) return 'no watchers';
  await sendTo(o.watchers.map((x) => x.authId), {
    title,
    body: parts.join(' · '),
    url: `/feed?item=${encodeURIComponent(`day:${today}`)}`,
    tag: `weekly-${ownerId}-${w.week_start}`,
  });
  return 'sent';
}

async function weekly(preview = false) {
  const { data: rows } = await db.from('watchers').select('owner_user_id');
  const owners = [...new Set((rows || []).map((r) => String(r.owner_user_id)))];
  const now = new Date();
  const out: Record<string, string> = {};
  for (const id of owners) {
    try { out[id] = await weeklyFor(id, now, preview); } catch (e) { out[id] = `error: ${(e as Error).message}`; }
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const secret = req.headers.get('x-notify-secret') || '';
  const { data: okSecret } = await db.rpc('notify_secret_ok', { p_secret: secret });
  if (okSecret !== true) return json({ error: 'unauthorized' }, 401);

  // Without VAPID keys we can't push: leave every row unclaimed so nothing is lost.
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: 'push not configured' }, 503);

  const body = await req.json().catch(() => ({}));
  if (body.action === 'weekly') return json({ ok: true, weekly: await weekly(body.preview === true) });
  const { owner_user_id } = body;
  const ownerId = String(owner_user_id ?? '');
  if (!/^-?\d+$/.test(ownerId)) return json({ error: 'owner_user_id' }, 400);

  // Wait until the job is due (batches quick posts), then clear it so new events queue a new run.
  const { data: job } = await db.from('notify_pending').select('due_at').eq('owner_user_id', ownerId).maybeSingle();
  const wait = job ? Math.min(25_000, Math.max(0, Date.parse(job.due_at) - Date.now())) : 0;
  if (wait) await new Promise((r) => setTimeout(r, wait));
  await db.from('notify_pending').delete().eq('owner_user_id', ownerId);

  const o = await loadOwner(ownerId);
  if (!o) return json({ ok: true, skipped: 'no owner' });
  const result = { comments: await comments(o), reactions: await reactions(o), posts: await posts(o) };
  return json({ ok: true, ...result });
});
