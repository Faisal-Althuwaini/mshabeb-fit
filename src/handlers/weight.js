const weightService = require('../services/weight.js');
const { getSupabase } = require('../supabase.js');
const { ensureUser, upsertWeight } = weightService;
const { getMotivational, getTrendMessage } = require('../messages.js');

const MIN_KG = 20;
const MAX_KG = 300;

function parseWeight(text) {
  const s = (text || '').trim().replace(/,/g, '.');
  const n = parseFloat(s);
  if (Number.isNaN(n)) return null;
  if (n < MIN_KG || n > MAX_KG) return null;
  return Math.round(n * 10) / 10;
}

async function handleWeightCommand(ctx) {
  const from = ctx.from;
  if (!from) return ctx.reply('تعذر التعرف عليك.');

  const text = ctx.message?.text || '';
  const args = text.split(/\s+/).slice(1).join(' ');
  const weight = parseWeight(args);

  if (weight === null) {
    return ctx.reply(
      `أرسل وزنك بالكيلوغرام. مثلاً:\n/weight 72.5\n\nالمجال الصحيح: ${MIN_KG}–${MAX_KG} كغ.`
    );
  }

  try {
    await ensureUser(getSupabase(), from.id, from);
    await upsertWeight(from.id, weight, new Date());
  } catch (e) {
    console.error('weight save error:', e);
    return ctx.reply('فشل الحفظ. حاول مرة أخرى.');
  }

  const todayStr = weightService.toDateString(new Date());
  const trend = await weightService.getWeeklyAverages(from.id);
  const msg = getTrendMessage(trend.thisWeekAvg, trend.lastWeekAvg);
  return ctx.reply(`تم الحفظ: ${weight} كغ لليوم ${todayStr}.\n\n${msg}`);
}

async function handlePlainNumber(ctx) {
  const from = ctx.from;
  if (!from) return;

  const text = (ctx.message?.text || '').trim();
  const weight = parseWeight(text);
  if (weight === null) return;

  try {
    await ensureUser(getSupabase(), from.id, from);
    await upsertWeight(from.id, weight, new Date());
  } catch (e) {
    console.error('weight save error:', e);
    return ctx.reply('فشل الحفظ. حاول مرة أخرى.');
  }

  const todayStr = weightService.toDateString(new Date());
  const trend = await weightService.getWeeklyAverages(from.id);
  const msg = getTrendMessage(trend.thisWeekAvg, trend.lastWeekAvg);

  return ctx.reply(`تم الحفظ: ${weight} كغ لليوم ${todayStr}.\n\n${msg}`);
}

module.exports = { handleWeightCommand, handlePlainNumber, parseWeight };
