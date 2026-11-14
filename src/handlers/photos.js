// Photos sent to Mushabbab (coach users only, D14/D15/D24):
//   caption starting with «فليكس» / "flex" → private flex POST (an album of up to 4 photos = one post)
//   anything else                          → meal post, visible to watchers
// Telegram delivers an album as separate messages sharing a media_group_id (only one carries the
// caption), so photos of the same album are processed in order and grouped here.
const crypto = require('crypto');
const { getSupabase } = require('../supabase.js');
const coach = require('../services/coach.js');

const FLEX_RE = /^\s*(فليكس|flex)(?=$|[\s:،,.-])[\s:،,.-]*/i;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FLEX_PHOTOS = 4;
const GROUP_TTL_MS = 5 * 60 * 1000;

// media_group_id → { chain, kind: 'flex'|'meal'|null, postId, count, replied }
const groups = new Map();

async function watcherCount(userId) {
  const { data, error } = await getSupabase().from('watchers').select('watcher_auth_user_id').eq('owner_user_id', userId);
  if (error) throw error;
  return (data || []).length;
}

async function downloadTelegramPhoto(ctx, fileId) {
  const link = await ctx.telegram.getFileLink(fileId);
  const res = await fetch(String(link));
  if (!res.ok) throw new Error(`telegram file HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > MAX_BYTES) throw new Error('photo too large');
  return buf;
}

async function upload(bucket, userId, day, buf) {
  const path = `${userId}/${day}/${crypto.randomUUID()}.jpg`;
  const { error } = await getSupabase().storage.from(bucket).upload(path, buf, { contentType: 'image/jpeg', upsert: false });
  if (error) throw error;
  return path;
}

async function processPhoto(ctx, g) {
  const from = ctx.from;
  const photos = ctx.message.photo;
  const settings = await coach.getSettings(from.id);
  const today = await coach.todayFor(settings);
  const rawCaption = (ctx.message.caption || '').trim();
  const isFlex = FLEX_RE.test(rawCaption) || g.kind === 'flex';
  const caption = (FLEX_RE.test(rawCaption) ? rawCaption.replace(FLEX_RE, '') : rawCaption).slice(0, 500) || null;
  const supabase = getSupabase();

  if (isFlex) {
    g.kind = 'flex';
    if (g.count >= MAX_FLEX_PHOTOS) {
      if (!g.warned) { g.warned = true; await ctx.reply(`الفليكس فيه ${MAX_FLEX_PHOTOS} صور بس، الباقي ما انحفظ.`); }
      return;
    }
    const buf = await downloadTelegramPhoto(ctx, photos[photos.length - 1].file_id);
    const path = await upload('flex-photos', from.id, today, buf);
    const entries = await coach.getAllEntries(from.id);
    const weight = entries.length ? entries[entries.length - 1].weight : null;
    if (!g.postId) {
      const { data: post, error } = await supabase.from('flex_posts').insert({
        user_id: from.id, taken_on: today, weight, caption, shared_with_watchers: false, tg_media_group: g.id || null,
      }).select('id').single();
      if (error) throw error;
      g.postId = post.id;
    } else if (caption) {
      await supabase.from('flex_posts').update({ caption }).eq('id', g.postId);
    }
    const { error } = await supabase.from('flex_photos').insert({
      user_id: from.id, taken_on: today, storage_path: path, weight_at_time: weight, caption: null,
      shared_with_watchers: false, post_id: g.postId, position: g.count,
    });
    if (error) throw error;
    g.count += 1;
    if (!g.replied) {
      g.replied = true;
      await ctx.reply('تم 💪 حفظت الفليكس (خاص لك). تقدر تضيف القياسات وتشاركه مع صاحبك من التطبيق.');
    }
    return;
  }

  g.kind = g.kind || 'meal';
  const buf = await downloadTelegramPhoto(ctx, photos[photos.length - 1].file_id);
  const path = await upload('meal-photos', from.id, today, buf);
  const { error } = await supabase.from('meal_posts').insert({
    user_id: from.id, local_date: today, storage_path: path, caption, source: 'telegram',
  });
  if (error) throw error;
  if (!g.replied) {
    g.replied = true;
    const n = await watcherCount(from.id).catch(() => 0);
    await ctx.reply(n > 0 ? 'تم 📸 نزلت الوجبة، صاحبك بيشوفها.' : 'تم 📸 حفظت الوجبة. ما عندك متابع للحين، تقدر تدعوه من إعدادات التطبيق.');
  }
}

async function handlePhoto(ctx) {
  const from = ctx.from;
  const photos = ctx.message?.photo;
  if (!from || !photos || photos.length === 0) return;
  if (!(await coach.isCoachEnabled(from.id).catch(() => false))) return; // original bot ignored photos

  const gid = ctx.message.media_group_id;
  let g;
  if (gid) {
    g = groups.get(gid);
    if (!g) {
      g = { id: gid, chain: Promise.resolve(), kind: null, postId: null, count: 0, replied: false };
      groups.set(gid, g);
      setTimeout(() => groups.delete(gid), GROUP_TTL_MS).unref?.();
    }
  } else {
    g = { id: null, chain: Promise.resolve(), kind: null, postId: null, count: 0, replied: false };
  }
  // Album photos are handled one after another so they land in the same post.
  g.chain = g.chain.then(() => processPhoto(ctx, g)).catch(async (e) => {
    console.error('photo handler error:', e.message || e);
    if (!g.errored) { g.errored = true; await ctx.reply('ما قدرت أحفظ الصورة. جرّب مرة ثانية.').catch(() => {}); }
  });
  return g.chain;
}

module.exports = { handlePhoto, FLEX_RE, _groups: groups };
