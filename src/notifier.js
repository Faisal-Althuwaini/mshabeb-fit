// Social notifications (D14, D16): comments, reactions, and the "quiet for 3 days" note.
// Runs inside the bot process. All sends go through Web Push; nothing goes to Telegram.
const { getSupabase } = require('./supabase.js');
const coach = require('./services/coach.js');
const push = require('./services/push.js');
const { loadStats } = require('./shared.js');

const REACTION_BATCH_MS = 30 * 60 * 1000;
const MISSED_DAYS_THRESHOLD = 3;

// recipient auth id → last reaction push time (in memory; a restart just allows one early batch)
const lastReactionPush = new Map();

const ITEM_AR = { meal: 'وجبتك', day: 'يومك', flex: 'صورتك' };

function itemUrl(kind, ref) {
  return `/feed?item=${encodeURIComponent(`${kind}:${ref}`)}`;
}

async function loadOwners(ownerIds) {
  const supabase = getSupabase();
  const ids = [...new Set(ownerIds)];
  if (ids.length === 0) return new Map();
  const [{ data: users }, { data: watchers }, { data: names }] = await Promise.all([
    supabase.from('users').select('telegram_user_id, auth_user_id, first_name').in('telegram_user_id', ids),
    supabase.from('watchers').select('owner_user_id, watcher_auth_user_id, display_name').in('owner_user_id', ids),
    supabase.from('coach_settings').select('user_id, display_name').in('user_id', ids),
  ]);
  const display = new Map((names || []).map((n) => [String(n.user_id), n.display_name]));
  const map = new Map();
  for (const u of users || []) {
    const name = display.get(String(u.telegram_user_id)) || u.first_name || 'صاحبك';
    map.set(String(u.telegram_user_id), { authId: u.auth_user_id, name, watchers: [] });
  }
  for (const w of watchers || []) {
    const o = map.get(String(w.owner_user_id));
    if (o) o.watchers.push({ authId: w.watcher_auth_user_id, name: w.display_name });
  }
  return map;
}

/** Pure: who gets told about an item written by `authorAuthId` on `owner`'s feed. */
function recipientsFor(owner, authorAuthId) {
  if (!owner) return [];
  if (authorAuthId && authorAuthId === owner.authId) {
    return owner.watchers.map((w) => w.authId).filter((id) => id !== authorAuthId);
  }
  return owner.authId ? [owner.authId] : [];
}

function authorName(owner, authorAuthId, fallback) {
  if (owner && authorAuthId === owner.authId) return owner.name;
  const w = owner?.watchers.find((x) => x.authId === authorAuthId);
  return fallback || w?.name || 'صاحبك';
}

async function processComments() {
  const supabase = getSupabase();
  const { data: rows, error } = await supabase
    .from('feed_comments')
    .select('id, owner_user_id, item_kind, item_ref, author_auth_user_id, author_name, body, created_at')
    .is('notified_at', null)
    .order('created_at', { ascending: true })
    .limit(50);
  if (error) throw error;
  if (!rows || rows.length === 0) return 0;

  const owners = await loadOwners(rows.map((r) => r.owner_user_id));
  for (const c of rows) {
    const owner = owners.get(String(c.owner_user_id));
    const isOwnerReply = owner && c.author_auth_user_id === owner.authId;
    const name = authorName(owner, c.author_auth_user_id, c.author_name);
    const title = isOwnerReply ? `${name} رد عليك` : `${name} علّق على ${ITEM_AR[c.item_kind] || 'منشورك'}`;
    await push
      .sendToAuthUsers(recipientsFor(owner, c.author_auth_user_id), {
        title,
        body: c.body.slice(0, 140),
        url: itemUrl(c.item_kind, c.item_ref),
        tag: `comment-${c.id}`,
      })
      .catch((e) => console.error('comment push error:', e.message));
    await supabase.from('feed_comments').update({ notified_at: new Date().toISOString() }).eq('id', c.id);
  }
  return rows.length;
}

async function processReactions(now = Date.now()) {
  const supabase = getSupabase();
  const { data: rows, error } = await supabase
    .from('feed_reactions')
    .select('owner_user_id, item_kind, item_ref, author_auth_user_id, emoji, created_at')
    .is('notified_at', null)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  if (!rows || rows.length === 0) return 0;

  const owners = await loadOwners(rows.map((r) => r.owner_user_id));
  const byRecipient = new Map(); // recipient → reactions
  const silent = []; // reactions nobody needs to hear about (owner reacting to own feed)
  for (const r of rows) {
    const recips = recipientsFor(owners.get(String(r.owner_user_id)), r.author_auth_user_id);
    const isOwnerReaction = owners.get(String(r.owner_user_id))?.authId === r.author_auth_user_id;
    if (isOwnerReaction || recips.length === 0) {
      silent.push(r);
      continue;
    }
    for (const id of recips) {
      if (!byRecipient.has(id)) byRecipient.set(id, []);
      byRecipient.get(id).push(r);
    }
  }

  const markDone = async (list) => {
    for (const r of list) {
      await supabase
        .from('feed_reactions')
        .update({ notified_at: new Date().toISOString() })
        .eq('owner_user_id', r.owner_user_id)
        .eq('item_kind', r.item_kind)
        .eq('item_ref', r.item_ref)
        .eq('author_auth_user_id', r.author_auth_user_id);
    }
  };
  await markDone(silent);

  let sent = 0;
  for (const [recipient, list] of byRecipient) {
    const last = lastReactionPush.get(recipient) || 0;
    if (now - last < REACTION_BATCH_MS) continue; // wait for the next window
    const owner = owners.get(String(list[0].owner_user_id));
    const emojis = [...new Set(list.map((r) => r.emoji))].join('');
    const title =
      list.length === 1
        ? `${authorName(owner, list[0].author_auth_user_id)} حط ${list[0].emoji} على ${ITEM_AR[list[0].item_kind] || 'منشورك'}`
        : `${list.length} تفاعلات جديدة ${emojis}`;
    await push
      .sendToAuthUsers([recipient], {
        title,
        body: 'افتح المتابعة',
        url: list.length === 1 ? itemUrl(list[0].item_kind, list[0].item_ref) : '/feed',
        tag: 'reactions',
      })
      .catch((e) => console.error('reaction push error:', e.message));
    lastReactionPush.set(recipient, now);
    await markDone(list);
    sent += 1;
  }
  return sent;
}

function inQuietHours(S, settings, now) {
  const toMin = (t) => {
    const [h, m] = String(t || '00:00').split(':').map(Number);
    return h * 60 + m;
  };
  const cur = S.localMinutes(now, settings.timezone || 'Asia/Riyadh');
  const start = toMin(settings.quiet_start || '23:00');
  const end = toMin(settings.quiet_end || '08:00');
  return start > end ? cur >= start || cur < end : cur >= start && cur < end;
}

async function processMissedDays(now = new Date()) {
  const S = await loadStats();
  const supabase = getSupabase();
  const { data: watchRows, error } = await supabase.from('watchers').select('owner_user_id');
  if (error) throw error;
  const ownerIds = [...new Set((watchRows || []).map((w) => String(w.owner_user_id)))];
  let created = 0;

  for (const ownerId of ownerIds) {
    try {
      const settings = await coach.getSettings(ownerId);
      if (!settings.coach_enabled) continue;
      if (await coach.isPaused(ownerId, now)) continue;
      if (inQuietHours(S, settings, now)) continue;
      const { snapshot } = await coach.getSnapshot(ownerId, now);
      if (snapshot.missedDays == null || snapshot.missedDays < MISSED_DAYS_THRESHOLD) continue;

      const lastActive = S.addDays(snapshot.today, -snapshot.missedDays);
      const { data: inserted, error: insErr } = await supabase
        .from('feed_events')
        .upsert(
          {
            owner_user_id: ownerId,
            kind: 'missed_days',
            local_date: snapshot.today,
            gap_key: lastActive,
            data: { days: snapshot.missedDays, last_active: lastActive },
          },
          { onConflict: 'owner_user_id,kind,gap_key', ignoreDuplicates: true }
        )
        .select('id');
      if (insErr) throw insErr;
      if (!inserted || inserted.length === 0) continue; // already told about this gap

      const owners = await loadOwners([ownerId]);
      const owner = owners.get(String(ownerId));
      await push
        .sendToAuthUsers(
          owner.watchers.map((w) => w.authId),
          {
            title: `${owner.name} غايب من ${S.toArabicDigits(snapshot.missedDays)} أيام`,
            body: 'يمكن يحتاج كلمة منك 👋',
            url: '/feed',
            tag: `missed-${ownerId}`,
          }
        )
        .catch((e) => console.error('missed-days push error:', e.message));
      created += 1;
    } catch (e) {
      console.error('missed-days error for owner', ownerId, e.message);
    }
  }
  return created;
}

function startNotifier(cron) {
  cron.schedule('* * * * *', async () => {
    try {
      await processComments();
      await processReactions();
    } catch (e) {
      console.error('notifier error:', e.message);
    }
  });
  cron.schedule('*/15 * * * *', () => processMissedDays().catch((e) => console.error('missed-days job:', e.message)));
  console.log(`Social notifier started (push ${push.isEnabled() ? 'enabled' : 'disabled: no VAPID keys'}).`);
}

module.exports = {
  startNotifier,
  processComments,
  processReactions,
  processMissedDays,
  recipientsFor,
  inQuietHours,
  _lastReactionPush: lastReactionPush,
};
