// M3: the coaching tick. Runs every 5 minutes inside the bot process (D1; plan §5 used pg_cron).
// For each coach user: decide which nudges are due (src/nudges.js), write the text (DeepSeek if
// available, otherwise a template), send via Telegram + Web Push, and log to coach_messages.
// Idempotent: a kind is never sent twice on the same local date. DRY_RUN=1 logs instead of sending.
const { getSupabase } = require('./supabase.js');
const coach = require('./services/coach.js');
const push = require('./services/push.js');
const deepseek = require('./services/deepseek.js');
const { loadStats, DEFAULT_TZ } = require('./shared.js');
const { decideNudges, renderTemplate } = require('./nudges.js');

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
  if (!deepseek.isEnabled()) return { text: fallback, usedFallback: true };
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
    const out = await deepseek.chatJson(
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

      const { data: u } = await getSupabase()
        .from('users').select('first_name, auth_user_id').eq('telegram_user_id', userId).maybeSingle();
      const name = settings.display_name || (u?.first_name || '').split(' ')[0];
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

module.exports = { startCoachTick, runTick, writeMessage };
