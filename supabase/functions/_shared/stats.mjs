// GENERATED from shared/stats.mjs by scripts/sync-shared.sh. Do not edit here.
// Mushabbab Coach — the one shared stats implementation (DECISIONS.md D8).
// Pure functions, no dependencies. Used by the Node bot (dynamic import), the PWA (Vite) and
// the coach-chat edge function (Deno). Dates are 'YYYY-MM-DD' strings in the user's local timezone.

// ── Digits & parsing ───────────────────────────────────────────────────────

const ARABIC_INDIC_ZERO = 0x0660; // ٠
const PERSIAN_ZERO = 0x06f0; // ۰

/** Convert Arabic-Indic / Persian digits to ASCII and any decimal separator (٫ , ،) to '.'. */
export function normalizeDigits(text) {
  return String(text ?? '')
    .replace(/[٠-٩]/g, (c) => String(c.charCodeAt(0) - ARABIC_INDIC_ZERO))
    .replace(/[۰-۹]/g, (c) => String(c.charCodeAt(0) - PERSIAN_ZERO))
    .replace(/[٫,،]/g, '.');
}

const NUMBER_RE = /^\d{1,3}(\.\d{1,2})?$/;

/** True when the whole message is just a number (any digit set / decimal separator). */
export function isNumberMessage(text) {
  return NUMBER_RE.test(normalizeDigits(text).trim());
}

export const WEIGHT_MIN = 40;
export const WEIGHT_MAX = 250;

/**
 * Parse a weight typed by the user.
 * @returns {{ok: true, value: number} | {ok: false, reason: 'nan' | 'range'}}
 */
export function parseWeightInput(text, { min = WEIGHT_MIN, max = WEIGHT_MAX } = {}) {
  const s = normalizeDigits(text).trim();
  if (!NUMBER_RE.test(s)) return { ok: false, reason: 'nan' };
  const n = Number(s);
  if (n < min || n > max) return { ok: false, reason: 'range' };
  return { ok: true, value: Math.round(n * 10) / 10 };
}

/** Format a number with Arabic-Indic digits and ٫ (e.g. 112.4 → '١١٢٫٤'; 110 → '١١٠'). */
export function toArabicDigits(value, decimals = 1) {
  if (value == null || Number.isNaN(Number(value))) return '';
  const n = Number(value);
  const factor = 10 ** decimals;
  const rounded = Math.round(n * factor) / factor;
  const s = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(decimals);
  return s
    .replace(/\d/g, (d) => String.fromCharCode(ARABIC_INDIC_ZERO + Number(d)))
    .replace('.', '٫')
    .replace('-', '−');
}

/** Signed change with Arabic digits: −٠٫٥ / +٠٫٣ / ٠ */
export function formatDelta(delta) {
  if (delta == null) return '';
  const r = Math.round(delta * 10) / 10;
  if (r === 0) return toArabicDigits(0);
  return (r > 0 ? '+' : '−') + toArabicDigits(Math.abs(r));
}

// ── Dates ──────────────────────────────────────────────────────────────────

/** Local calendar date for `now` in `timeZone`, as 'YYYY-MM-DD'. */
export function localDate(now = new Date(), timeZone = 'Asia/Riyadh') {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Local wall-clock time for `now` in `timeZone`, as minutes since midnight. */
export function localMinutes(now = new Date(), timeZone = 'Asia/Riyadh') {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return get('hour') * 60 + get('minute');
}

function toUtcDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fromUtcDate(date) {
  return date.toISOString().slice(0, 10);
}

export function addDays(dateStr, n) {
  const d = toUtcDate(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return fromUtcDate(d);
}

/** 0 = Sunday … 6 = Saturday */
export function dayOfWeek(dateStr) {
  return toUtcDate(dateStr).getUTCDay();
}

/** Whole days from a to b (b − a). */
export function daysBetween(a, b) {
  return Math.round((toUtcDate(b) - toUtcDate(a)) / 86400000);
}

/** First day of the week containing dateStr. weekStartDow 0 = Sunday (D2). */
export function weekStart(dateStr, weekStartDow = 0) {
  const offset = (dayOfWeek(dateStr) - weekStartDow + 7) % 7;
  return addDays(dateStr, -offset);
}

// ── Averages & weekly stats ────────────────────────────────────────────────

/**
 * Mean rounded to 1 decimal, half up — identical to the bot's original
 * Math.round(mean * 10) / 10, but computed in integer hundredths so float noise can't flip a .x5.
 */
export function average(weights) {
  const list = (weights || []).map(Number).filter((w) => !Number.isNaN(w));
  if (list.length === 0) return null;
  const n = list.length;
  const sumH = list.reduce((s, w) => s + Math.round(w * 100), 0);
  return Math.floor((sumH + 5 * n) / (10 * n)) / 10;
}

export const COMPLETE_WEEK_MIN_WEIGHINS = 3;

/**
 * @param {{date: string, weight: number}[]} entries  weigh-ins (one per day)
 * @param {{day: string, minimum_done?: boolean, lifted?: boolean}[]} checks
 * @returns {{week_start, avg_weight, n_weighins, minimum_days, lifting_days, is_complete}[]} oldest first
 */
export function weeklyStats(entries = [], checks = [], { weekStartDow = 0 } = {}) {
  const weeks = new Map();
  const bucket = (ws) => {
    if (!weeks.has(ws)) weeks.set(ws, { weights: [], minimum: 0, lifting: 0 });
    return weeks.get(ws);
  };
  for (const e of entries) bucket(weekStart(e.date, weekStartDow)).weights.push(Number(e.weight));
  for (const c of checks) {
    const b = bucket(weekStart(c.day, weekStartDow));
    if (c.minimum_done) b.minimum += 1;
    if (c.lifted) b.lifting += 1;
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([ws, b]) => ({
      week_start: ws,
      avg_weight: average(b.weights),
      n_weighins: b.weights.length,
      minimum_days: b.minimum,
      lifting_days: b.lifting,
      is_complete: b.weights.length >= COMPLETE_WEEK_MIN_WEIGHINS,
    }));
}

// ── Activity, streaks ──────────────────────────────────────────────────────

/** Days with a weigh-in OR the minimum action done. */
export function activeDays(entries = [], checks = []) {
  const set = new Set(entries.map((e) => e.date));
  for (const c of checks) if (c.minimum_done) set.add(c.day);
  return set;
}

/** Consecutive active days ending today, or yesterday if today isn't active yet. */
export function currentStreak(active, today) {
  let day = active.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (active.has(day)) {
    n += 1;
    day = addDays(day, -1);
  }
  return n;
}

export function bestStreak(active) {
  const days = [...active].sort();
  let best = 0;
  let run = 0;
  let prev = null;
  for (const d of days) {
    run = prev && daysBetween(prev, d) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = d;
  }
  return best;
}

/** Days since the last active day (0 = active today). null if never active. */
export function missedDays(active, today) {
  const past = [...active].filter((d) => d <= today).sort();
  if (past.length === 0) return null;
  return daysBetween(past[past.length - 1], today);
}

// ── Ladder ─────────────────────────────────────────────────────────────────

/** [112, 110, … 82, 80] — always ends exactly at goal. */
export function ladderSteps(start, goal, step = 2) {
  start = Number(start);
  goal = Number(goal);
  step = Math.abs(Number(step)) || 2;
  const steps = [];
  for (let v = start; v > goal + 1e-9; v = Math.round((v - step) * 10) / 10) steps.push(v);
  steps.push(goal);
  return steps;
}

/**
 * A step is reached when a COMPLETE weekly average ≤ step. Only weeks from the coach start
 * (`coach_started_on`, its whole week) count: older history (e.g. a previous attempt at a lower
 * weight) must not pre-fill the ladder.
 */
export function ladderProgress(weekly, { start_weight, goal_weight, ladder_step, coach_started_on, week_start_dow = 0 }) {
  if (start_weight == null || goal_weight == null || Number(goal_weight) >= Number(start_weight)) {
    return { steps: [], reached: [], next: null, remaining_to_next: null };
  }
  const steps = ladderSteps(start_weight, goal_weight, ladder_step);
  const fromWeek = coach_started_on ? weekStart(coach_started_on, week_start_dow ?? 0) : null;
  const complete = weekly.filter(
    (w) => w.is_complete && w.avg_weight != null && (fromWeek == null || w.week_start >= fromWeek)
  );
  const bestAvg = complete.length ? Math.min(...complete.map((w) => w.avg_weight)) : null;
  const reached = bestAvg == null ? [] : steps.filter((s) => bestAvg <= s);
  const next = steps.find((s) => !reached.includes(s)) ?? null;
  const latest = complete.length ? complete[complete.length - 1].avg_weight : null;
  return {
    steps,
    reached,
    next,
    remaining_to_next: next != null && latest != null ? Math.round((latest - next) * 10) / 10 : null,
  };
}

/**
 * Steps newly reached because of `weekStartDate`'s average: reached by that week but not by any
 * earlier complete week. Used to fire `milestone` messages.
 */
export function newlyReachedSteps(weekly, settings, weekStartDate) {
  const before = weekly.filter((w) => w.week_start < weekStartDate);
  const upTo = weekly.filter((w) => w.week_start <= weekStartDate);
  const a = new Set(ladderProgress(before, settings).reached);
  return ladderProgress(upTo, settings).reached.filter((s) => !a.has(s));
}

// ── Snapshot ───────────────────────────────────────────────────────────────

/**
 * Everything the bot / PWA / coach needs, computed once.
 * @param {object} p
 * @param {{date: string, weight: number}[]} p.entries
 * @param {{day: string, minimum_done?: boolean, lifted?: boolean, workout_label?: string|null}[]} p.checks
 * @param {object} p.settings  coach_settings row
 * @param {string} p.today     local date
 */
export function buildSnapshot({ entries = [], checks = [], settings, today }) {
  const dow = settings.week_start_dow ?? 0;
  const weekly = weeklyStats(entries, checks, { weekStartDow: dow });
  const thisWs = weekStart(today, dow);
  const lastWs = addDays(thisWs, -7);
  const empty = (ws) => ({
    week_start: ws,
    avg_weight: null,
    n_weighins: 0,
    minimum_days: 0,
    lifting_days: 0,
    is_complete: false,
  });
  const thisWeek = weekly.find((w) => w.week_start === thisWs) || empty(thisWs);
  const lastWeek = weekly.find((w) => w.week_start === lastWs) || empty(lastWs);
  const active = activeDays(entries, checks);
  // Total lost counts only weeks since the coach started (same rule as the ladder).
  const coachFrom = settings.coach_started_on ? weekStart(settings.coach_started_on, dow) : null;
  const complete = weekly.filter((w) => w.is_complete && (coachFrom == null || w.week_start >= coachFrom));
  const latestComplete = complete.length ? complete[complete.length - 1] : null;
  const sortedEntries = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const todayEntry = sortedEntries.find((e) => e.date === today) || null;
  const prevEntry = [...sortedEntries].reverse().find((e) => e.date < today) || null;
  const todayCheck = checks.find((c) => c.day === today) || null;

  return {
    today,
    weekly,
    thisWeek,
    lastWeek,
    weekChange:
      thisWeek.avg_weight != null && lastWeek.avg_weight != null
        ? Math.round((thisWeek.avg_weight - lastWeek.avg_weight) * 10) / 10
        : null,
    todayWeight: todayEntry ? Number(todayEntry.weight) : null,
    previousWeight: prevEntry ? Number(prevEntry.weight) : null,
    todayCheck,
    streak: currentStreak(active, today),
    bestStreak: bestStreak(active),
    missedDays: missedDays(active, today),
    activeToday: active.has(today),
    activeYesterday: active.has(addDays(today, -1)),
    totalLost: latestComplete && settings.start_weight != null
      ? Math.round((Number(settings.start_weight) - latestComplete.avg_weight) * 10) / 10
      : null,
    ladder: ladderProgress(weekly, settings),
  };
}
