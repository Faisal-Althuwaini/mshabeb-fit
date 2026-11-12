// M3: the coaching tick. Runs every 5 minutes inside the bot process (D1; plan §5 used pg_cron).
// For each coach user: decide which nudges are due (src/nudges.js), write the text (the LLM via OpenRouter if
// available, otherwise a template), send via Telegram + Web Push, and log to coach_messages.
// Idempotent: a kind is never sent twice on the same local date. DRY_RUN=1 logs instead of sending.
const { getSupabase } = require('./supabase.js');
const coach = require('./services/coach.js');
const push = require('./services/push.js');
const llm = require('./services/llm.js');
const { loadStats, DEFAULT_TZ } = require('./shared.js');
const { decideNudges, renderTemplate, inQuietHours } = require('./nudges.js');

const KIND_BRIEF = {
  nudge_morning: 'Gentle morning reminder: he has not sent today\'s weight yet. Ask for the weight and mention the minimum action.',
  nudge_firm: 'Firm but kind "don\'t skip twice": yesterday had no activity and today has none so far. Yesterday is fine; today counts. Ask for the minimum action and the weight.',
  comeback: 'Comeback after 3+ days away. NO guilt. Normalise it, use what he achieved before (total lost / best streak) if given, ask for ONE minimum action only.',
  lifting_check: 'Thursday evening: lifting days this week are below the required count. Remind him the weekend is still open for a session.',
};

const SYSTEM_PROMPT = `You are "مشبب", a personal weight-loss coach. Always write short, natural Saudi dialect Arabic.
Your job is consistency, not perfection. Rules: weekly averages beat daily weight; "لا تغيب مرتين"; "أقل شي يكفي" (the minimum action counts as a success); never shame, guilt or insult (firm is okay, harsh is not); be specific and use his numbers; one focus only; no lists.
Safety: no calorie targets, meal plans, fasting, supplements, medication or diagnoses.
Return ONLY JSON: {"message": "<one Telegram message, at most 220 characters, may include one emoji>"}`;

const ARABIC = /[؀-ۿ]/;

async function writeMessage(kind, ctx) {
  const fallback = renderTemplate(kind, ctx);
  if (!llm.isEnabled()) return { text: fallback, usedFallback: true };
  const { snapshot, settings, name, recent } = ctx;
  const facts = {
    name,
    minimum_action: settings.minimum_action,
    streak: snapshot.streak,
    best_streak: snapshot.bestStreak,
    missed_days: snapshot.missedDays,
    total_lost: snapshot.totalLost,
    this_week_avg: snapshot.thisWeek.avg_weight,
    last_week_avg: snapshot.lastWeek.avg_weight,
    lifting_this_week: snapshot.thisWeek.lifting_days,
    lifting_required: settings.lifting_days_required,
    next_ladder_step: snapshot.ladder.next,
    recent_messages_do_not_repeat: recent,
  };
  try {
    const out = await llm.chatJson(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `Task: ${KIND_BRIEF[kind]}\nFacts (JSON): ${JSON.stringify(facts)}` },
      ],
      { temperature: 0.7, maxTokens: 200 }
    );
    const msg = typeof out.message === 'string' ? out.message.trim() : '';
    if (msg.length >= 8 && msg.length <= 300 && ARABIC.test(msg)) return { text: msg, usedFallback: false };
  } catch (e) {
    console.error(`nudge LLM failed (${kind}):`, e.message);
  }
  return { text: fallback, usedFallback: true };
}

async function coachUsers() {
  const { data, error } = await getSupabase().from('coach_settings').select('user_id').eq('coach_enabled', true);
  if (error) throw error;
  return (data || []).map((r) => r.user_id);
}

async function messageState(userId, today) {
  const supabase = getSupabase();
  const [{ data: todayRows }, { data: lastComeback }, { data: recentRows }] = await Promise.all([
    supabase.from('coach_messages').select('kind').eq('user_id', userId).eq('local_date', today),
    supabase.from('coach_messages').select('local_date').eq('user_id', userId).eq('kind', 'comeback')
      .order('created_at', { ascending: false }).limit(1),
    supabase.from('coach_messages').select('content').eq('user_id', userId)
      .order('created_at', { ascending: false }).limit(3),
  ]);
  return {
    sentToday: (todayRows || []).map((r) => r.kind),
    lastComebackDate: lastComeback?.[0]?.local_date ?? null,
    recent: (recentRows || []).map((r) => r.content),
  };
}

// ── Weekly report timing ──────────────────────────────────────────────────

async function weeklyReportDue(S, userId, settings, snapshot, now) {
  const tz = settings.timezone || DEFAULT_TZ;
  const today = S.localDate(now, tz);
  if (S.dayOfWeek(today) !== (settings.weekly_report_dow ?? 6)) return false;
  const nowMin = S.localMinutes(now, tz);
  const [h, m] = String(settings.weekly_report_time || '21:00').split(':').map(Number);
  const at = h * 60 + (m || 0);
  if (nowMin < at || nowMin >= at + 180) return false;
  if (inQuietHours(nowMin, settings.quiet_start || '23:00', settings.quiet_end || '08:00')) return false;
  const { data } = await getSupabase().from('coach_messages').select('id')
    .eq('user_id', userId).eq('kind', 'weekly_report').eq('week_start', snapshot.thisWeek.week_start).limit(1);
  return !(data && data.length);
}

// ── Ladder milestones ──────────────────────────────────────────────────────

/** Pure: steps newly reached (below the start weight) that haven't been celebrated yet. */
function newMilestones(snapshot, settings, celebrated) {
  const start = Number(settings.start_weight);
  return (snapshot.ladder.reached || []).filter((s) => s < start && !celebrated.has(s)).sort((a, b) => a - b);
}

async function celebratedSteps(userId) {
  const { data } = await getSupabase().from('coach_messages').select('data').eq('user_id', userId).eq('kind', 'milestone');
  const set = new Set();
  for (const r of data || []) for (const s of r.data?.steps || []) set.add(Number(s));
  return set;
}

async function checkMilestones(bot, { S, userId, settings, snapshot, today, name, authId, now, dry }) {
  const steps = newMilestones(snapshot, settings, await celebratedSteps(userId));
  if (steps.length === 0) return null;
  const tz = settings.timezone || DEFAULT_TZ;
  if (inQuietHours(S.localMinutes(now, tz), settings.quiet_start || '23:00', settings.quiet_end || '08:00')) return null; // celebrate in the morning
  const step = steps[0]; // the lowest one reached
  const ar = (n) => S.toArabicDigits(n);
  const avg = [...snapshot.weekly].reverse().find((w) => w.is_complete)?.avg_weight ?? null;
  const next = snapshot.ladder.next;
  const { data: watchers } = await getSupabase().from('watchers').select('watcher_auth_user_id').eq('owner_user_id', userId);
  const watcherIds = (watchers || []).map((w) => w.watcher_auth_user_id);
  const text =
    `🎉 نزلت تحت ${ar(step)}!` +
    (avg != null ? ` متوسط الأسبوع ${ar(avg)}.` : '') +
    (next != null && snapshot.ladder.remaining_to_next > 0 ? `\nالدرجة الجاية ${ar(next)} (باقي ${ar(snapshot.ladder.remaining_to_next)} كيلو).` : '') +
    (watcherIds.length ? '\nوقلت لصاحبك 😎' : '') +
    '\nكمّل، المتوسط ما يكذب 💪';
  if (dry) {
    console.log(`[DRY_RUN] ${userId} milestone: ${text}`);
    return { step, text };
  }
  const channels = [];
  try { await bot.telegram.sendMessage(userId, text); channels.push('telegram'); } catch (e) { console.error('milestone telegram failed:', e.message); }
  if (authId) {
    const n = await push.sendToAuthUsers([authId], { title: 'مشبب 🎉', body: text.split('\n')[0], url: '/progress', tag: `milestone-${step}` }).catch(() => 0);
    if (n > 0) channels.push('push');
  }
  await coach.logMessage({ userId, kind: 'milestone', content: text, data: { step, steps, avg }, channels, usedFallback: true, localDate: today });
  await getSupabase().from('feed_events').upsert(
    { owner_user_id: userId, kind: 'milestone', local_date: today, gap_key: `step-${step}`, data: { step, avg } },
    { onConflict: 'owner_user_id,kind,gap_key', ignoreDuplicates: true }
  );
  if (watcherIds.length) {
    await push.sendToAuthUsers(watcherIds, { title: `${name || 'صاحبك'} نزل تحت ${ar(step)} 🎉`, body: 'حط له 🔥', url: '/feed', tag: `milestone-${userId}-${step}` }).catch(() => 0);
  }
  return { step, text };
}

/** Run one tick. Returns the list of {userId, kind, text} that were sent (or would be, in DRY_RUN). */
async function runTick(bot, now = new Date()) {
  const S = await loadStats();
  const dry = process.env.DRY_RUN === '1';
  const sent = [];

  for (const userId of await coachUsers()) {
    try {
      const { settings, snapshot } = await coach.getSnapshot(userId, now);
      const tz = settings.timezone || DEFAULT_TZ;
      const today = S.localDate(now, tz);
      const state = await messageState(userId, today);
      const { data: u } = await getSupabase()
        .from('users').select('first_name, auth_user_id').eq('telegram_user_id', userId).maybeSingle();
      const name = settings.display_name || (u?.first_name || '').split(' ')[0];

      const ms = await checkMilestones(bot, { S, userId, settings, snapshot, today, name, authId: u?.auth_user_id, now, dry });
      if (ms) sent.push({ userId, kind: 'milestone', text: ms.text });

      // Weekly report (M4): on weekly_report_dow at weekly_report_time (±3h window), once per week.
      if (await weeklyReportDue(S, userId, settings, snapshot, now)) {
        const { sendWeeklyReport } = require('./coachAI.js');
        for (const r of await sendWeeklyReport(bot, userId, now, { dry })) sent.push({ userId, ...r });
      }

      const kinds = decideNudges({
        settings,
        snapshot,
        nowMin: S.localMinutes(now, tz),
        dow: S.dayOfWeek(today),
        sentToday: state.sentToday,
        lastComebackDate: state.lastComebackDate,
        daysBetween: S.daysBetween,
      });
      if (kinds.length === 0) continue;

      const dayIndex = S.daysBetween('2026-01-01', today);

      for (const kind of kinds) {
        const { text, usedFallback } = await writeMessage(kind, { S, snapshot, settings, name, dayIndex, recent: state.recent });
        if (dry) {
          console.log(`[DRY_RUN] ${userId} ${kind}: ${text}`);
          sent.push({ userId, kind, text });
          continue;
        }
        const channels = [];
        try {
          await bot.telegram.sendMessage(userId, text);
          channels.push('telegram');
        } catch (e) {
          console.error(`nudge telegram failed (${kind}):`, e.response?.error_code || '', e.message);
        }
        if (u?.auth_user_id) {
          const n = await push.sendToAuthUsers([u.auth_user_id], { title: 'مشبب', body: text, url: '/', tag: kind }).catch(() => 0);
          if (n > 0) channels.push('push');
        }
        // Logged even if delivery failed, so a blocked chat can't cause a resend loop.
        await coach.logMessage({ userId, kind, content: text, channels, usedFallback, localDate: today });
        sent.push({ userId, kind, text });
      }
    } catch (e) {
      console.error('coach tick error for', userId, e.message);
    }
  }
  return sent;
}

function startCoachTick(cron, bot) {
  cron.schedule('*/5 * * * *', () => runTick(bot).catch((e) => console.error('coach tick:', e.message)));
  console.log(`Coach tick started (every 5 min${process.env.DRY_RUN === '1' ? ', DRY_RUN' : ''}).`);
}

module.exports = { startCoachTick, runTick, writeMessage, newMilestones };
