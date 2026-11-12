// New Mushabbab Coach commands: /done, /gym, /pause, /resume, /report, /link, free text.
const weightService = require('../services/weight.js');
const coach = require('../services/coach.js');
const deepseek = require('../services/deepseek.js');
const { getSupabase } = require('../supabase.js');
const { loadStats } = require('../shared.js');
const replies = require('../coachReplies.js');
const { getTrendMessage } = require('../messages.js');
const { saveWeightAndReply } = require('./weight.js');

const MAX_PAUSE_DAYS = 60;

function args(ctx) {
  return (ctx.message?.text || '').trim().split(/\s+/).slice(1);
}

async function withUser(ctx, fn) {
  const from = ctx.from;
  if (!from) return ctx.reply('تعذر التعرف عليك.');
  try {
    await weightService.ensureUser(getSupabase(), from.id, from);
    return await fn(from.id);
  } catch (e) {
    console.error('coach handler error:', e);
    return ctx.reply('صار خطأ. جرّب مرة ثانية.');
  }
}

// ── /done, مشيت ────────────────────────────────────────────────────────────

async function markMinimum(ctx, userId, { silent = false } = {}) {
  const S = await loadStats();
  const settings = await coach.getSettings(userId);
  const today = await coach.todayFor(settings);
  await coach.upsertCheck(userId, today, { minimum_done: true });
  if (silent) return;
  const { snapshot } = await coach.getSnapshot(userId);
  return ctx.reply(replies.minimumDone(S, snapshot, settings.minimum_action));
}

function handleDone(ctx) {
  return withUser(ctx, (userId) => markMinimum(ctx, userId));
}

// ── /gym, حديد ─────────────────────────────────────────────────────────────

function parseWorkoutLabel(word) {
  const w = (word || '').toLowerCase();
  if (['anterior', 'a', 'أمامي', 'امامي'].includes(w)) return 'anterior';
  if (['posterior', 'p', 'خلفي'].includes(w)) return 'posterior';
  return w || null;
}

async function markLifted(ctx, userId, label, { silent = false } = {}) {
  const S = await loadStats();
  const settings = await coach.getSettings(userId);
  const today = await coach.todayFor(settings);
  const patch = { lifted: true };
  if (label) patch.workout_label = label;
  await coach.upsertCheck(userId, today, patch);
  if (silent) return;
  const { snapshot } = await coach.getSnapshot(userId);
  return ctx.reply(replies.lifted(S, snapshot, settings.lifting_days_required ?? 2, label));
}

function handleGym(ctx) {
  const label = parseWorkoutLabel(args(ctx)[0]);
  return withUser(ctx, (userId) => markLifted(ctx, userId, label));
}

// ── /pause N, /resume ──────────────────────────────────────────────────────

function handlePause(ctx) {
  return withUser(ctx, async (userId) => {
    const S = await loadStats();
    const n = parseInt(S.normalizeDigits(args(ctx)[0] || ''), 10);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PAUSE_DAYS) {
      return ctx.reply('اكتب عدد الأيام، مثلاً: /pause 5\n(للسفر أو المرض. ترجعها بـ /resume)');
    }
    const settings = await coach.getSettings(userId);
    const today = await coach.todayFor(settings);
    const until = S.addDays(today, n - 1);
    await coach.updateSettings(userId, { paused_until: until });
    return ctx.reply(
      `تمام ⏸️ وقفت التذكيرات لين ${replies.dateAr(S, until)}.\n` +
        'إذا تبي ترسل وزنك أو تمشي خلال هالفترة، أرسله عادي.\nترجعها قبل بـ /resume'
    );
  });
}

function handleResume(ctx) {
  return withUser(ctx, async (userId) => {
    await coach.updateSettings(userId, { paused_until: null });
    return ctx.reply('هلا بعودتك 👋 رجعت التذكيرات. اليوم بس سوّ أقل شي.');
  });
}

// ── /report ────────────────────────────────────────────────────────────────

/**
 * Build the weekly report text for a user.
 * @param {'current'|'latest'} which  'current' = this week; 'latest' = this week if it has
 *   any weigh-ins, otherwise last week.
 */
async function buildReport(userId, which = 'latest') {
  const S = await loadStats();
  const { settings, snapshot } = await coach.getSnapshot(userId);
  let week = snapshot.thisWeek;
  let prev = snapshot.lastWeek;
  if (which === 'latest' && week.n_weighins === 0 && snapshot.lastWeek.n_weighins > 0) {
    week = snapshot.lastWeek;
    const prevStart = S.addDays(week.week_start, -7);
    prev = snapshot.weekly.find((w) => w.week_start === prevStart) || null;
  }
  const text = replies.weeklyReport(S, {
    week,
    prev,
    snap: snapshot,
    settings,
    trendMessage: getTrendMessage(week.avg_weight, prev?.avg_weight ?? null),
  });
  return { text, week, prev, snapshot, settings };
}

function handleReport(ctx) {
  return withUser(ctx, async (userId) => {
    if (!(await coach.isCoachEnabled(userId))) {
      const { buildLegacyWeeklySummary } = require('../legacySummary.js');
      const legacy = await buildLegacyWeeklySummary(userId);
      return ctx.reply(legacy || 'لا توجد بيانات كافية بعد. سجّل وزنك هذا الأسبوع.', legacy ? { parse_mode: 'Markdown' } : undefined);
    }
    const { text } = await buildReport(userId, 'latest');
    return ctx.reply(text);
  });
}

// ── /coach — opt in / out (DECISIONS.md D12) ──────────────────────────────

const COACH_INTRO =
  'مشبب المدرب 🧭\n' +
  'يتابعك يوم بيوم: يذكّرك إذا غبت، يحسب سلّم النزول، ويرسل لك تقرير أسبوعي.\n\n' +
  'تفعّله بكتابة وزنك الهدف:\n/coach 80\n' +
  '(وزن البداية = آخر وزن سجلته. تقدر تحدده بنفسك: /coach 80 112)';

function handleCoach(ctx) {
  return withUser(ctx, async (userId) => {
    const S = await loadStats();
    const a = args(ctx).map((x) => S.normalizeDigits(x));
    const settings = await coach.getSettings(userId);

    if (a[0] && a[0].toLowerCase() === 'off') {
      await coach.updateSettings(userId, { coach_enabled: false });
      return ctx.reply('تمام، وقفت المدرب. التسجيل والتذكير اليومي يشتغلون مثل قبل.\nترجعه بـ /coach');
    }

    if (a.length === 0) {
      if (!settings.coach_enabled) return ctx.reply(COACH_INTRO);
      const { snapshot } = await coach.getSnapshot(userId);
      const lines = [
        'المدرب شغّال ✅',
        `البداية: ${S.toArabicDigits(settings.start_weight)} ← الهدف: ${S.toArabicDigits(settings.goal_weight)}`,
        `أقل شي: ${settings.minimum_action}`,
      ];
      if (snapshot.ladder.next != null) lines.push(`الدرجة الجاية: ${S.toArabicDigits(snapshot.ladder.next)}`);
      lines.push('', 'تغيّر الهدف: /coach 80 112\nتوقفه: /coach off');
      return ctx.reply(lines.join('\n'));
    }

    const goal = S.parseWeightInput(a[0]);
    if (!goal.ok) return ctx.reply('اكتب الوزن الهدف رقم، مثلاً: /coach 80');

    let start;
    if (a[1]) {
      const st = S.parseWeightInput(a[1]);
      if (!st.ok) return ctx.reply('وزن البداية ما يبدو صحيح. مثال: /coach 80 112');
      start = st.value;
    } else {
      const entries = await coach.getAllEntries(userId);
      if (entries.length === 0) {
        return ctx.reply('ما عندك وزن مسجل. أرسل وزن البداية معه، مثلاً: /coach 80 112');
      }
      start = entries[entries.length - 1].weight;
    }
    if (goal.value >= start) {
      return ctx.reply(`الهدف (${S.toArabicDigits(goal.value)}) لازم يكون أقل من البداية (${S.toArabicDigits(start)}).`);
    }

    const patch = { coach_enabled: true, start_weight: start, goal_weight: goal.value };
    if (!settings.coach_enabled || !settings.coach_started_on) patch.coach_started_on = await coach.todayFor(settings);
    if (!settings.coach_enabled) {
      // The old daily reminder becomes the smart morning nudge, at the same time (D18).
      const { getReminder } = require('./reminder.js');
      const r = await getReminder(userId).catch(() => null);
      if (r?.enabled && r.time) patch.morning_check_time = r.time;
    }
    await coach.updateSettings(userId, patch);
    const steps = S.ladderSteps(start, goal.value, settings.ladder_step ?? 2);
    return ctx.reply(
      `تم ✅ المدرب شغّال.\n` +
        `سلّم النزول: ${S.toArabicDigits(start)} ← ${S.toArabicDigits(goal.value)} (${S.toArabicDigits(steps.length - 1)} درجات)\n\n` +
        'القواعد:\n• لا تغيب مرتين\n• أقل شي يكفي (' + settings.minimum_action + ')\n• المتوسط الأسبوعي أهم من وزن اليوم\n\n' +
        'ابدأ: أرسل وزنك، أو «مشيت»، أو «حديد».'
    );
  });
}

// ── /link 123456 ───────────────────────────────────────────────────────────

function handleLink(ctx) {
  return withUser(ctx, async (userId) => {
    const S = await loadStats();
    const code = S.normalizeDigits(args(ctx)[0] || '');
    if (!/^\d{6}$/.test(code)) {
      return ctx.reply('افتح إعدادات التطبيق وانسخ الكود (٦ أرقام)، وأرسله هكذا:\n/link 123456');
    }
    if (!(await coach.isCoachEnabled(userId))) {
      return ctx.reply('التطبيق جزء من المدرب. فعّله أول: /coach');
    }
    const result = await coach.consumeLinkCode(code, userId);
    const msg = {
      ok: 'تم الربط ✅ الحين اللي تسجله هنا يطلع في التطبيق، والعكس.',
      invalid: 'الكود غلط. تأكد منه أو اطلب كود جديد من التطبيق.',
      expired: 'الكود انتهى (صلاحيته ١٠ دقايق). اطلب كود جديد من التطبيق.',
      taken: 'حساب التطبيق هذا مربوط بحساب تيليجرام ثاني.',
    }[result];
    return ctx.reply(msg);
  });
}

// ── Free text ──────────────────────────────────────────────────────────────

const DONE_WORDS = ['مشيت', '✅ مشيت', 'done'];
const GYM_WORDS = ['حديد', '🏋️ حديد', 'gym'];

const EXTRACT_PROMPT = `You extract fitness log data from a short Arabic (often Saudi dialect) or English message sent to a weight-tracking bot.
Return ONLY a JSON object with exactly these keys:
{"weight": number|null, "minimum_done": true|null, "lifted": true|null, "workout_label": "anterior"|"posterior"|null, "ate_out": true|false|null, "confident": boolean, "question": string|null}
Rules:
- weight: today's body weight in kg if the message clearly states one (e.g. "112.4", "١١٢٫٤", "وزني 112"). Otherwise null. Never guess.
- minimum_done: true if they say they walked / did their minimum / cardio today (e.g. "مشيت", "مشيت ربع ساعة", "سويت كارديو"). Otherwise null.
- lifted: true if they say they lifted weights / trained at the gym today (e.g. "حديد", "تمرنت", "رحت الجيم"). Otherwise null.
- workout_label: "anterior" for أمامي/front/push-type day, "posterior" for خلفي/back/pull-type day, else null.
- ate_out: true if they say they ate out / at a restaurant (e.g. "أكلت برا", "مطعم"); false if they explicitly say they didn't; else null.
- Only fill what the message actually says about TODAY. If it's about another day, or it's unclear, set confident=false.
- confident: true only if every non-null field is clearly stated.
- question: if confident is false or the message is ambiguous, ONE very short clarifying question in Saudi Arabic. Otherwise null.
- If the message isn't a log at all (greeting, question, chit-chat), return all nulls, confident=false, question=null.`;

async function extractLog(text) {
  const out = await deepseek.chatJson(
    [
      { role: 'system', content: EXTRACT_PROMPT },
      { role: 'user', content: text },
    ],
    { temperature: 0, maxTokens: 200 }
  );
  return {
    weight: typeof out.weight === 'number' ? out.weight : null,
    minimum_done: out.minimum_done === true,
    lifted: out.lifted === true,
    workout_label: ['anterior', 'posterior'].includes(out.workout_label) ? out.workout_label : null,
    ate_out: typeof out.ate_out === 'boolean' ? out.ate_out : null,
    confident: out.confident === true,
    question: typeof out.question === 'string' && out.question.trim() ? out.question.trim().slice(0, 200) : null,
  };
}

// «أمس ١١١٫٨» / «١١١٫٨ أمس» / «مشيت أمس» / «حديد أمس» — log yesterday (coach users).
const YESTERDAY = '(?:أمس|امس|البارح|البارحة)';
const YDAY_WEIGHT_RE = new RegExp(`^(?:${YESTERDAY}\\s+(\\S+)|(\\S+)\\s+${YESTERDAY})$`);
const YDAY_DONE_RE = new RegExp(`^(?:✅\\s*)?مشيت\\s+${YESTERDAY}$`);
const YDAY_GYM_RE = new RegExp(`^(?:🏋️\\s*)?(?:حديد|تمرنت)\\s+${YESTERDAY}$`);

/** @returns {Promise<boolean>} true if the message was a "yesterday" log and was handled. */
async function handleYesterday(ctx, text) {
  const S = await loadStats();
  const norm = S.normalizeDigits(text).trim();
  const isDone = YDAY_DONE_RE.test(text.trim());
  const isGym = YDAY_GYM_RE.test(text.trim());
  const m = !isDone && !isGym ? norm.match(YDAY_WEIGHT_RE) : null;
  const w = m && S.isNumberMessage(m[1] || m[2]) ? m : null;
  if (!w && !isDone && !isGym) return false;
  if (!(await coach.isCoachEnabled(ctx.from.id).catch(() => false))) return false;

  await withUser(ctx, async (userId) => {
    const settings = await coach.getSettings(userId);
    const today = await coach.todayFor(settings);
    const yesterday = S.addDays(today, -1);
    if (w) {
      const r = S.parseWeightInput(w[1] || w[2]);
      if (!r.ok) return ctx.reply(`الوزن لازم يكون بين ${S.toArabicDigits(S.WEIGHT_MIN)} و ${S.toArabicDigits(S.WEIGHT_MAX)}.`);
      await weightService.upsertWeight(userId, r.value, yesterday, 'telegram');
      const { snapshot } = await coach.getSnapshot(userId);
      return ctx.reply(`تم ✅ ${S.toArabicDigits(r.value)} لأمس\n` + replies.weightSaved(S, snapshot, r.value).split('\n').slice(1).join('\n'));
    }
    await coach.upsertCheck(userId, yesterday, isDone ? { minimum_done: true } : { lifted: true });
    const { snapshot } = await coach.getSnapshot(userId);
    return ctx.reply(`تم ✅ سجلت ${isDone ? 'أقل شي' : 'حديد 🏋️'} لأمس\n${replies.streakLine(S, snapshot)}`);
  });
  return true;
}

const HELP_SHORT = 'أرسل وزنك رقم (مثل ١١٢٫٤)، أو «مشيت» إذا سويت أقل شي، أو «حديد» إذا تمرنت.';

async function handleFreeText(ctx) {
  const from = ctx.from;
  const text = (ctx.message?.text || '').trim();
  if (!from || !text || text.startsWith('/')) return;

  if (DONE_WORDS.includes(text)) return handleDone(ctx);
  if (GYM_WORDS.includes(text)) return withUser(ctx, (userId) => markLifted(ctx, userId, null));
  if (await handleYesterday(ctx, text)) return;

  if (!deepseek.isEnabled()) return; // previous behaviour: ignore unknown text
  if (!(await coach.isCoachEnabled(from.id).catch(() => false))) return; // coach users only (D12)

  return withUser(ctx, async (userId) => {
    const S = await loadStats();
    let log;
    try {
      log = await extractLog(text);
    } catch (e) {
      console.error('DeepSeek extract failed:', e.message);
      return ctx.reply(`ما قدرت أفهمها الحين 🙏 ${HELP_SHORT}`);
    }

    const weightParsed = log.weight != null ? S.parseWeightInput(String(log.weight)) : null;
    const hasSomething = (weightParsed && weightParsed.ok) || log.minimum_done || log.lifted || log.ate_out != null;

    if (!log.confident || !hasSomething) {
      return ctx.reply(log.question || HELP_SHORT);
    }
    if (weightParsed && !weightParsed.ok) {
      return ctx.reply(`الوزن ${S.toArabicDigits(log.weight)} ما يبدو صحيح. أرسله مرة ثانية؟`);
    }

    // Save checks first (silently), then the weight reply carries the summary.
    const settings = await coach.getSettings(userId);
    const today = await coach.todayFor(settings);
    const patch = {};
    if (log.minimum_done) patch.minimum_done = true;
    if (log.lifted) {
      patch.lifted = true;
      if (log.workout_label) patch.workout_label = log.workout_label;
    }
    if (log.ate_out != null) patch.ate_out = log.ate_out;
    if (Object.keys(patch).length) await coach.upsertCheck(userId, today, patch);

    const understood = [];
    if (log.minimum_done) understood.push('أقل شي ✅');
    if (log.lifted) understood.push('حديد 🏋️');
    if (log.ate_out === true) understood.push('أكلت برا 🍽️');
    const extraLine = understood.length ? `وسجّلت: ${understood.join('، ')}` : '';

    if (weightParsed && weightParsed.ok) {
      const saved = await saveWeightAndReply(ctx, weightParsed.value, { extraLine });
      if (!saved && extraLine) await ctx.reply(extraLine);
      return;
    }
    const { snapshot } = await coach.getSnapshot(userId);
    return ctx.reply(`تم 👍 ${extraLine.replace('وسجّلت: ', 'سجّلت: ')}\n${replies.streakLine(S, snapshot)}`);
  });
}

module.exports = {
  handleDone,
  handleGym,
  handlePause,
  handleResume,
  handleReport,
  handleLink,
  handleCoach,
  handleFreeText,
  handleYesterday,
  buildReport,
  parseWorkoutLabel,
  extractLog,
};
