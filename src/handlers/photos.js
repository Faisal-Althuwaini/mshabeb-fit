// Photos sent to Mushabbab (coach users only, D14/D15):
//   caption starting with «فليكس» / "flex" → private flex photo
//   anything else                          → meal post, visible to watchers
const crypto = require('crypto');
const { getSupabase } = require('../supabase.js');
const coach = require('../services/coach.js');

// (\b doesn't work after Arabic letters, so use an explicit lookahead.)
const FLEX_RE = /^\s*(فليكس|flex)(?=$|[\s:،,.-])[\s:،,.-]*/i;
const MAX_BYTES = 5 * 1024 * 1024;

async function watcherCount(userId) {
  const { data, error } = await getSupabase()
    .from('watchers')
    .select('watcher_auth_user_id')
    .eq('owner_user_id', userId);
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

async function handlePhoto(ctx) {
  const from = ctx.from;
  const photos = ctx.message?.photo;
  if (!from || !photos || photos.length === 0) return;
  if (!(await coach.isCoachEnabled(from.id).catch(() => false))) return; // original bot ignored photos

  try {
    const settings = await coach.getSettings(from.id);
    const today = await coach.todayFor(settings);
    const rawCaption = (ctx.message.caption || '').trim();
    const isFlex = FLEX_RE.test(rawCaption);
    const caption = (isFlex ? rawCaption.replace(FLEX_RE, '') : rawCaption).slice(0, 500) || null;

    // Telegram sends several sizes; the last is the largest (≤1280px, already JPEG).
    const largest = photos[photos.length - 1];
    const buf = await downloadTelegramPhoto(ctx, largest.file_id);

    const bucket = isFlex ? 'flex-photos' : 'meal-photos';
    const path = `${from.id}/${today}/${crypto.randomUUID()}.jpg`;
    const supabase = getSupabase();
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, buf, { contentType: 'image/jpeg', upsert: false });
    if (upErr) throw upErr;

    if (isFlex) {
      const entries = await coach.getAllEntries(from.id);
      const last = entries.length ? entries[entries.length - 1].weight : null;
      const { error } = await supabase.from('flex_photos').insert({
        user_id: from.id,
        taken_on: today,
        storage_path: path,
        weight_at_time: last,
        caption,
        shared_with_watchers: false,
      });
      if (error) throw error;
      return ctx.reply('تم 💪 حفظت صورة الفليكس. خاصة لك، وتقدر تشاركها مع صاحبك من التطبيق.');
    }

    const { error } = await supabase.from('meal_posts').insert({
      user_id: from.id,
      local_date: today,
      storage_path: path,
      caption,
      source: 'telegram',
    });
    if (error) throw error;
    const n = await watcherCount(from.id).catch(() => 0);
    return ctx.reply(
      n > 0
        ? 'تم 📸 نزلت الوجبة، صاحبك بيشوفها.'
        : 'تم 📸 حفظت الوجبة. ما عندك متابع للحين، تقدر تدعوه من إعدادات التطبيق.'
    );
  } catch (e) {
    console.error('photo handler error:', e.message || e);
    return ctx.reply('ما قدرت أحفظ الصورة. جرّب مرة ثانية.');
  }
}

module.exports = { handlePhoto, FLEX_RE };
