// Mushabbab AI coach — shared, pure pieces (plan §6). Used by the bot (weekly report, trend alert)
// and by the coach-chat edge function (a copy is synced to supabase/functions/_shared/).
// No I/O here.
import * as S from './stats.mjs';

// ── System prompt (plan §6.3, adapted: goal 90, «أقل شي يكفي», Saudi dialect) ──────────────
export const SYSTEM_PROMPT = `You are "مشبب", a personal weight-loss coach. Always reply in short, natural Saudi dialect Arabic (not formal Arabic).
His pattern: he starts strong, then one bad week makes him quit entirely. Your job is consistency, not perfection.
Rules:
- Base judgments on WEEKLY AVERAGES, never one day's weight. Daily fluctuation (water, salt) is normal; say so if he's worried.
- "لا تغيب مرتين": one missed day is fine; push hard against a second.
- "أقل شي يكفي": the minimum action counts as a success. Praise minimum days.
- Never shame, guilt or insult. Firm is okay; harsh is not. After a gap: welcome him back and ask for one small action.
- Be specific and use his numbers. One focus at a time. No long lists.
- His known derailers: chocolate, eating out, low movement. Baseline: 2 lifting days/week (anterior/posterior), cardio, the minimum action.
- What motivates him: visible change (flex photos) and friends noticing (a friend watches his progress in the app).
- Safety: no calorie targets, no meal plans, no fasting or extreme restriction, no supplements or medication advice, no diagnoses. If the weekly average drops faster than ~1.5 kg/week for 2+ weeks, tell him to slow down and eat enough. If he mentions pain, dizziness or other health concerns, tell him to see a doctor. Redirect crash-diet requests to sustainable habits.
- Don't invent data. If something is missing, say so.`;

// ── Context builder (plan §6.1) ──────────────────────────────────────────
export function buildContext({ entries, checks, settings, today, recentCoachMessages = [], name = null }) {
  const snap = S.buildSnapshot({ entries, checks, settings, today });
  const byDay = new Map();
  for (let i = 13; i >= 0; i--) byDay.set(S.addDays(today, -i), { day: S.addDays(today, -i), weight: null, minimum: false, lifted: false });
  for (const e of entries) if (byDay.has(e.date)) byDay.get(e.date).weight = e.weight;
  for (const c of checks) if (byDay.has(c.day)) Object.assign(byDay.get(c.day), { minimum: !!c.minimum_done, lifted: !!c.lifted });
  return {
    today,
    name,
    settings: {
      start: Number(settings.start_weight), goal: Number(settings.goal_weight),
      target_per_4w: Number(settings.target_loss_per_4w ?? 3),
      minimum_action: settings.minimum_action, lifting_required: settings.lifting_days_required ?? 2,
    },
    last_14_days: [...byDay.values()],
    weekly: snap.weekly.slice(-8).map((w) => ({
      week_start: w.week_start, avg: w.avg_weight, n: w.n_weighins, complete: w.is_complete,
      minimum_days: w.minimum_days, lifting_days: w.lifting_days,
    })),
    streak: snap.streak,
    best_streak: snap.bestStreak,
    missed_days: snap.missedDays,
    total_lost: snap.totalLost,
    next_ladder_step: snap.ladder.next,
    remaining_to_next_step: snap.ladder.remaining_to_next,
    recent_coach_messages: recentCoachMessages.slice(0, 3),
  };
}

// ── Weekly report contract (plan §6.2) ───────────────────────────────────
export const TONES = ['celebrate', 'steady', 'push', 'comeback'];
const ARABIC = /[؀-ۿ]/;
const str = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max && ARABIC.test(v);

/** @returns {{ok: true, report: object} | {ok: false, error: string}} */
export function validateReport(r) {
  if (!r || typeof r !== 'object') return { ok: false, error: 'not an object' };
  if (!str(r.headline, 80)) return { ok: false, error: 'headline must be Arabic, ≤ 60 chars' };
  if (!Array.isArray(r.went_well) || r.went_well.length < 1 || r.went_well.length > 2 || !r.went_well.every((x) => str(x, 140)))
    return { ok: false, error: 'went_well must be 1–2 short Arabic items' };
  const watch = r.watch_out ?? [];
  if (!Array.isArray(watch) || watch.length > 2 || !watch.every((x) => str(x, 140)))
    return { ok: false, error: 'watch_out must be 0–2 short Arabic items' };
  if (!str(r.focus_next_week, 160)) return { ok: false, error: 'focus_next_week must be ONE short Arabic action' };
  if (!TONES.includes(r.tone)) return { ok: false, error: `tone must be one of ${TONES.join('|')}` };
  return {
    ok: true,
    report: {
      headline: r.headline.trim(), went_well: r.went_well.map((x) => x.trim()),
      watch_out: watch.map((x) => x.trim()), focus_next_week: r.focus_next_week.trim(), tone: r.tone,
    },
  };
}

export function reportPrompt(context, week) {
  return `Write Faisal's weekly report for the week starting ${week.week_start}.
Return ONLY JSON with exactly these keys:
{"headline": "≤ 60 chars, Saudi Arabic", "went_well": ["1–2 short items"], "watch_out": ["0–2 short items"], "focus_next_week": "ONE concrete action", "tone": "celebrate | steady | push | comeback"}
Use his numbers. If the week has fewer than 3 weigh-ins, say the average is rough. Always find something that went well, even in a bad week.
Context (JSON): ${JSON.stringify(context)}`;
}

/** Deterministic report from stats, used when the LLM is off or fails twice. */
export function fallbackReport({ week, prev, settings }) {
  const ar = (n) => S.toArabicDigits(n);
  const req = settings.lifting_days_required ?? 2;
  const change = week.avg_weight != null && prev?.avg_weight != null ? Math.round((week.avg_weight - prev.avg_weight) * 10) / 10 : null;
  const went = [];
  const watch = [];
  if (change != null && change < 0) went.push(`المتوسط نزل ${ar(Math.abs(change))} كيلو عن الأسبوع اللي فات`);
  if (week.minimum_days >= 4) went.push(`سويت أقل شي ${ar(week.minimum_days)} أيام`);
  if (week.lifting_days >= req) went.push(`قفلت الحديد ${ar(week.lifting_days)} من ${ar(req)}`);
  if (week.n_weighins >= 5 && went.length < 2) went.push(`وزنت نفسك ${ar(week.n_weighins)} مرات، التزام`);
  if (went.length === 0) went.push(week.n_weighins > 0 ? 'سجلت وزنك ورجعت، وهذا أهم شي' : 'الأسبوع خلص، والجاي صفحة جديدة');
  if (change != null && change > 0.2) watch.push(`المتوسط زاد ${ar(change)}، شيك على الأكل برا والشوكولاتة`);
  if (week.lifting_days < req) watch.push(`الحديد ${ar(week.lifting_days)} من ${ar(req)}، باقي حصة`);
  const tone = week.n_weighins === 0 ? 'comeback' : change != null && change < -0.2 ? 'celebrate' : change != null && change > 0.2 ? 'push' : 'steady';
  const headline = { celebrate: 'أسبوع نازل 👏', steady: 'أسبوع ثابت، كمّل', push: 'أسبوع صعب، نرجع نشد', comeback: 'نرجع من اليوم 👋' }[tone];
  const focus = week.lifting_days < req
    ? `حصتين حديد الأسبوع الجاي (أمامي وخلفي)`
    : week.minimum_days < 5 ? `${settings.minimum_action || 'مشي ١٥ دقيقة'} ٥ أيام على الأقل` : 'كمّل نفس الشي، والمتوسط بيتكفل';
  return { headline, went_well: went.slice(0, 2), watch_out: watch.slice(0, 2), focus_next_week: focus, tone };
}

/** Telegram / plain text rendering (done in code, not by the LLM). */
export function renderReport(report, { week, prev, settings, snapshot }) {
  const ar = (n) => S.toArabicDigits(n);
  const req = settings.lifting_days_required ?? 2;
  const lines = [`📊 ${report.headline}`, ''];
  if (week.avg_weight != null) {
    let l = `المتوسط: ${ar(week.avg_weight)}`;
    if (prev?.avg_weight != null) l += ` (${S.formatDelta(week.avg_weight - prev.avg_weight)})`;
    lines.push(l + `  ·  حديد ${ar(week.lifting_days)} من ${ar(req)}  ·  أقل شي ${ar(week.minimum_days)} من ٧`);
  }
  lines.push('', '✅ مشى زين:', ...report.went_well.map((x) => `• ${x}`));
  if (report.watch_out.length) lines.push('', '👀 انتبه:', ...report.watch_out.map((x) => `• ${x}`));
  lines.push('', `🎯 الأسبوع الجاي: ${report.focus_next_week}`);
  if (snapshot?.ladder?.next != null && snapshot.ladder.remaining_to_next > 0) {
    lines.push(`🪜 الدرجة الجاية ${ar(snapshot.ladder.next)} (باقي ${ar(snapshot.ladder.remaining_to_next)})`);
  }
  return lines.join('\n');
}

// ── Trend alert (plan §5): 2 complete weeks in a row, each rising ≥ 0.2 kg ─────
export function trendAlert(weekly) {
  const complete = weekly.filter((w) => w.is_complete && w.avg_weight != null);
  if (complete.length < 3) return null;
  const [a, b, c] = complete.slice(-3);
  const consecutive = (x, y) => S.daysBetween(x.week_start, y.week_start) === 7;
  if (!consecutive(a, b) || !consecutive(b, c)) return null;
  const d1 = Math.round((b.avg_weight - a.avg_weight) * 10) / 10;
  const d2 = Math.round((c.avg_weight - b.avg_weight) * 10) / 10;
  if (d1 < 0.2 || d2 < 0.2) return null;
  // Likely cause from the data: fewer minimum days / lifting than before.
  const cause = c.minimum_days < a.minimum_days ? 'movement' : c.lifting_days < a.lifting_days ? 'lifting' : 'food';
  return { weeks: [a.week_start, b.week_start, c.week_start], rises: [d1, d2], total: Math.round((d1 + d2) * 10) / 10, cause, week_start: c.week_start };
}

export function fallbackTrendText(alert, settings) {
  const ar = (n) => S.toArabicDigits(n);
  const fix = {
    movement: `أقل شي (${settings.minimum_action || 'مشي ١٥ دقيقة'}) قلّ عندك. رجّعه ٥ أيام هالأسبوع.`,
    lifting: 'الحديد قلّ. ثبّت حصتين هالأسبوع.',
    food: 'الحركة ثابتة، فالأغلب الأكل: قلّل الأكل برا والشوكولاتة هالأسبوع.',
  }[alert.cause];
  return `⚠️ تنبيه بدري: المتوسط زاد أسبوعين ورا بعض (+${ar(alert.rises[0])} ثم +${ar(alert.rises[1])}). مو نهاية العالم، بس نوقفها الحين.\n${fix}`;
}

/** Safety: average dropping faster than 1.5 kg/week for 2+ weeks → slow down. */
export function tooFast(weekly) {
  const complete = weekly.filter((w) => w.is_complete && w.avg_weight != null).slice(-3);
  if (complete.length < 3) return false;
  const [a, b, c] = complete;
  return a.avg_weight - b.avg_weight > 1.5 && b.avg_weight - c.avg_weight > 1.5;
}
