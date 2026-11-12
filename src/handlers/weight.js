const { Markup } = require('telegraf');
const weightService = require('../services/weight.js');
const coach = require('../services/coach.js');
const { getSupabase } = require('../supabase.js');
const { loadStats } = require('../shared.js');
const replies = require('../coachReplies.js');
const { getTrendMessage } = require('../messages.js');

const JUMP_CONFIRM_KG = 3;
// Original bot range, kept for users who haven't opted in to the coach (DECISIONS.md D12).
const LEGACY_RANGE = { min: 20, max: 300 };

async function isCoachUser(userId) {
  return coach.isCoachEnabled(userId);
}

/** Original reply, unchanged, for non-coach users. */
async function legacySaveAndReply(ctx, weight) {
  const from = ctx.from;
  const todayStr = weightService.toDateString(new Date());
  await weightService.upsertWeight(from.id, weight, todayStr, 'telegram');
  const trend = await weightService.getWeeklyAverages(from.id);
  const msg = getTrendMessage(trend.thisWeekAvg, trend.lastWeekAvg);
  await ctx.reply(`تم الحفظ: ${weight} كغ لليوم ${todayStr}.\n\n${msg}`);
  return true;
}

/** Kept for backwards compatibility: returns a number or null. Accepts any digit set. */
async function parseWeight(text) {
  const S = await loadStats();
  const r = S.parseWeightInput(text);
  return r.ok ? r.value : null;
}

function rangeHelp(S) {
  return `أرسل وزنك بالكيلو، مثلاً: ١١٢٫٤ أو 112.4\nلازم يكون بين ${S.toArabicDigits(S.WEIGHT_MIN)} و ${S.toArabicDigits(S.WEIGHT_MAX)}.`;
}

/**
 * Save today's weight and reply. Asks for confirmation when it differs from the previous
 * weigh-in by more than 3 kg (unless `confirmed`).
 * @returns {Promise<boolean>} true if saved
 */
async function saveWeightAndReply(ctx, weight, { confirmed = false, extraLine = '' } = {}) {
  const S = await loadStats();
  const from = ctx.from;
  await weightService.ensureUser(getSupabase(), from.id, from);
  if (!(await isCoachUser(from.id))) return legacySaveAndReply(ctx, weight);

  if (!confirmed) {
    const { snapshot } = await coach.getSnapshot(from.id);
    if (snapshot.previousWeight != null && Math.abs(weight - snapshot.previousWeight) > JUMP_CONFIRM_KG) {
      await ctx.reply(
        `متأكد؟ ${S.toArabicDigits(weight)} يختلف أكثر من ٣ كيلو عن آخر وزن (${S.toArabicDigits(snapshot.previousWeight)}).`,
        Markup.inlineKeyboard([
          [
            Markup.button.callback('إيه، احفظه', `wconfirm:${weight}`),
            Markup.button.callback('لا، غلطت', 'wcancel'),
          ],
        ])
      );
      return false;
    }
  }

  const settings = await coach.getSettings(from.id);
  const today = await coach.todayFor(settings);
  await weightService.upsertWeight(from.id, weight, today, 'telegram');
  const { snapshot } = await coach.getSnapshot(from.id);
  await ctx.reply(replies.weightSaved(S, snapshot, weight) + (extraLine ? `\n${extraLine}` : ''));
  return true;
}

async function handleWeightCommand(ctx) {
  const from = ctx.from;
  if (!from) return ctx.reply('تعذر التعرف عليك.');
  const S = await loadStats();

  const text = ctx.message?.text || '';
  const args = text.split(/\s+/).slice(1).join(' ');
  const coachUser = await isCoachUser(from.id).catch(() => false);
  const r = S.parseWeightInput(args, coachUser ? undefined : LEGACY_RANGE);
  if (!r.ok) {
    return ctx.reply(
      coachUser
        ? rangeHelp(S)
        : `أرسل وزنك بالكيلوغرام. مثلاً:\n/weight 72.5\n\nالمجال الصحيح: ${LEGACY_RANGE.min}–${LEGACY_RANGE.max} كغ.`
    );
  }

  try {
    await saveWeightAndReply(ctx, r.value);
  } catch (e) {
    console.error('weight save error:', e);
    return ctx.reply('ما قدرت أحفظ. جرّب مرة ثانية.');
  }
}

async function handlePlainNumber(ctx) {
  const from = ctx.from;
  if (!from) return;
  const S = await loadStats();

  const coachUser = await isCoachUser(from.id).catch(() => false);
  const r = S.parseWeightInput(ctx.message?.text || '', coachUser ? undefined : LEGACY_RANGE);
  if (!r.ok) return coachUser ? ctx.reply(rangeHelp(S)) : undefined; // original bot ignored these

  try {
    await saveWeightAndReply(ctx, r.value);
  } catch (e) {
    console.error('weight save error:', e);
    return ctx.reply('ما قدرت أحفظ. جرّب مرة ثانية.');
  }
}

async function handleWeightConfirm(ctx) {
  // Only coach users ever see the confirm buttons.
  await ctx.answerCbQuery?.().catch(() => {});
  const S = await loadStats();
  const r = S.parseWeightInput(ctx.match?.[1] || '');
  await ctx.editMessageReplyMarkup?.(undefined).catch(() => {});
  if (!r.ok) return ctx.reply(rangeHelp(S));
  try {
    await saveWeightAndReply(ctx, r.value, { confirmed: true });
  } catch (e) {
    console.error('weight confirm error:', e);
    return ctx.reply('ما قدرت أحفظ. جرّب مرة ثانية.');
  }
}

async function handleWeightCancel(ctx) {
  await ctx.answerCbQuery?.().catch(() => {});
  await ctx.editMessageReplyMarkup?.(undefined).catch(() => {});
  return ctx.reply('تمام، ما حفظت شي. أرسل الوزن الصحيح.');
}

module.exports = {
  handleWeightCommand,
  handlePlainNumber,
  handleWeightConfirm,
  handleWeightCancel,
  saveWeightAndReply,
  parseWeight,
  isCoachUser,
};
