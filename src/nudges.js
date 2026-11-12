// M3 smart nudges: PURE decision logic + template texts (plan §5, §6.4).
// decideNudges(...) → which nudge kinds are due right now. No I/O here, so it's fully testable.

const NUDGE_KINDS = ['nudge_morning', 'nudge_firm', 'comeback', 'lifting_check'];
const MAX_NUDGES_PER_DAY = 2;
const WINDOW_MIN = 180; // a nudge may fire up to 3h after its time (covers missed ticks / restarts)
const COMEBACK_EVERY_DAYS = 3;
const THURSDAY = 4;

const toMin = (t) => {
  const [h, m] = String(t || '00:00').split(':').map(Number);
  return h * 60 + (m || 0);
};

/** Quiet hours may wrap midnight (23:00 → 08:00). */
function inQuietHours(nowMin, quietStart, quietEnd) {
  const s = toMin(quietStart);
  const e = toMin(quietEnd);
  if (s === e) return false;
  return s > e ? nowMin >= s || nowMin < e : nowMin >= s && nowMin < e;
}

const inWindow = (nowMin, at) => nowMin >= toMin(at) && nowMin < toMin(at) + WINDOW_MIN;

/**
 * @param {object} p
 * @param {object} p.settings     coach_settings row
 * @param {object} p.snapshot     buildSnapshot(...) result
 * @param {number} p.nowMin       local minutes since midnight
 * @param {number} p.dow          local day of week (0 = Sunday)
 * @param {string[]} p.sentToday  coach_messages kinds already sent today (local date)
 * @param {string|null} p.lastComebackDate  local date of the last comeback message
 * @param {(a: string, b: string) => number} p.daysBetween
 * @returns {string[]} kinds to send now, in priority order, already capped
 */
function decideNudges({ settings, snapshot, nowMin, dow, sentToday, lastComebackDate, daysBetween }) {
  if (!settings?.coach_enabled) return [];
  if (settings.paused_until && settings.paused_until >= snapshot.today) return [];
  if (inQuietHours(nowMin, settings.quiet_start || '23:00', settings.quiet_end || '08:00')) return [];

  const sent = new Set(sentToday || []);
  const nudgesSentToday = (sentToday || []).filter((k) => NUDGE_KINDS.includes(k)).length;
  let budget = MAX_NUDGES_PER_DAY - nudgesSentToday;
  if (budget <= 0) return [];

  const due = [];
  const missed = snapshot.missedDays; // null = never active
  const evening = inWindow(nowMin, settings.evening_check_time || '20:00');

  // Evening, most important first.
  if (evening && missed != null && missed >= 3 && !sent.has('comeback')) {
    const recent = lastComebackDate && daysBetween(lastComebackDate, snapshot.today) < COMEBACK_EVERY_DAYS;
    if (!recent) due.push('comeback');
  } else if (evening && missed === 2 && !sent.has('nudge_firm')) {
    // yesterday had no activity and neither has today (last active = the day before yesterday)
    due.push('nudge_firm');
  }

  // Morning: no weigh-in yet today.
  if (inWindow(nowMin, settings.morning_check_time || '11:00') && snapshot.todayWeight == null && !sent.has('nudge_morning')) {
    due.push('nudge_morning');
  }

  // Thursday evening: lifting behind target.
  const required = settings.lifting_days_required ?? 2;
  if (evening && dow === THURSDAY && snapshot.thisWeek.lifting_days < required && !sent.has('lifting_check')) {
    due.push('lifting_check');
  }

  return due.slice(0, Math.max(0, budget));
}

// ── Templates (fallback; also used when DeepSeek is off) ─────────────────

const TEMPLATES = {
  nudge_morning: [
    'صباح الخير 👋 لا تنسى ترسل وزنك اليوم، وخلّ أقل شي ({min}) في بالك.',
    'صباحك نشاط ☀️ وزن اليوم؟ رقم واحد بس وخلصنا.',
    'هلا {name} 👋 أرسل وزنك، والمتوسط الأسبوعي يتكفل بالباقي.',
    'وزن اليوم يا {name}؟ ولا تشيل هم الرقم، المهم المتوسط.',
  ],
  nudge_firm: [
    'أمس عادي، بس اليوم لا يفوتك. {min} وأرسل وزنك، وبس. لا تغيب مرتين 💪',
    'يوم واحد غياب طبيعي، يومين لا. سوّ أقل شي اليوم ({min}) وانتهينا.',
    'اليوم هو اللي يفرق. {min} الحين، حتى لو ما عندك وقت لأكثر.',
  ],
  comeback: [
    'هلا والله 👋 الغياب يصير لكل الناس. {lost}اليوم بس سوّ أقل شي: {min}.',
    'رجعتك أهم من غيابك. {lost}خطوة وحدة اليوم: {min}.',
    'ما فات مات 😄 {best}نبدأ من اليوم: {min}، وأرسل وزنك.',
  ],
  lifting_check: [
    'باقي لك الويكند لحصة الحديد 🏋️ ({done}/{req} هالأسبوع)',
    'الخميس وصل وحديدك {done}/{req}. حصة وحدة بالويكند وتقفل الأسبوع 💪',
  ],
};

/** Deterministic rotation so the same day doesn't repeat yesterday's wording. */
function pickTemplate(kind, dayIndex) {
  const list = TEMPLATES[kind];
  return list[((dayIndex % list.length) + list.length) % list.length];
}

function renderTemplate(kind, { S, snapshot, settings, name, dayIndex }) {
  const ar = (n) => S.toArabicDigits(n);
  const vars = {
    min: settings.minimum_action || 'مشي ١٥ دقيقة',
    name: name || '',
    lost: snapshot.totalLost != null && snapshot.totalLost > 0 ? `قبل كنت نازل ${ar(snapshot.totalLost)} كيلو، يعني تقدر. ` : '',
    best: snapshot.bestStreak > 1 ? `أطول سلسلة لك ${ar(snapshot.bestStreak)} يوم. ` : '',
    done: ar(snapshot.thisWeek.lifting_days),
    req: ar(settings.lifting_days_required ?? 2),
  };
  return pickTemplate(kind, dayIndex)
    .replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '')
    .replace(/\s+/g, ' ')
    .replace(/ ([.،!؟])/g, '$1')
    .trim();
}

module.exports = {
  decideNudges,
  renderTemplate,
  inQuietHours,
  NUDGE_KINDS,
  MAX_NUDGES_PER_DAY,
  TEMPLATES,
};
