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

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const secret = req.headers.get('x-notify-secret') || '';
  const { data: okSecret } = await db.rpc('notify_secret_ok', { p_secret: secret });
  if (okSecret !== true) return json({ error: 'unauthorized' }, 401);

  // Without VAPID keys we can't push: leave every row unclaimed so nothing is lost.
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) return json({ error: 'push not configured' }, 503);

  const { owner_user_id } = await req.json().catch(() => ({}));
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
