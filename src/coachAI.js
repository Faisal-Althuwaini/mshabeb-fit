// M4: LLM weekly report + trend alert (plan §6.2, §5). Pure logic lives in shared/coach.mjs.
const path = require('path');
const { pathToFileURL } = require('url');
const { getSupabase } = require('./supabase.js');
const coach = require('./services/coach.js');
const llm = require('./services/llm.js');
const push = require('./services/push.js');
const { loadStats, DEFAULT_TZ } = require('./shared.js');

let coachModP = null;
const loadCoach = () =>
  (coachModP ||= import(pathToFileURL(path.join(__dirname, '..', 'shared', 'coach.mjs')).href));

async function recentContents(userId) {
  const { data } = await getSupabase().from('coach_messages').select('content')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(3);
  return (data || []).map((r) => r.content);
}

async function ownerInfo(userId, settings) {
  const { data: u } = await getSupabase().from('users').select('first_name, auth_user_id').eq('telegram_user_id', userId).maybeSingle();
  return { name: settings.display_name || (u?.first_name || '').split(' ')[0], authId: u?.auth_user_id || null };
}

/** LLM report with validation, one re-ask, then the template fallback. */
async function writeReport(C, context, week, fallbackArgs) {
  if (!llm.isEnabled()) return { report: C.fallbackReport(fallbackArgs), usedFallback: true };
  const messages = [
    { role: 'system', content: C.SYSTEM_PROMPT },
    { role: 'user', content: C.reportPrompt(context, week) },
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const out = await llm.chatJson(messages, { temperature: 0.5, maxTokens: 500 });
      const v = C.validateReport(out);
      if (v.ok) return { report: v.report, usedFallback: false };
      messages.push({ role: 'assistant', content: JSON.stringify(out) }, { role: 'user', content: `Invalid: ${v.error}. Return the corrected JSON only.` });
    } catch (e) {
      console.error('weekly report LLM failed:', e.message);
      break;
    }
  }
  return { report: C.fallbackReport(fallbackArgs), usedFallback: true };
}

async function writeTrendText(C, context, alert, settings) {
  const fallback = C.fallbackTrendText(alert, settings);
  if (!llm.isEnabled()) return { text: fallback, usedFallback: true };
  try {
    const out = await llm.chatJson(
      [
        { role: 'system', content: C.SYSTEM_PROMPT },
        { role: 'user', content: `Early warning: the weekly average rose two complete weeks in a row (${JSON.stringify(alert)}). Likely cause from the data: ${alert.cause}. Write ONE short message: calm early warning + ONE concrete fix for this week. Return ONLY JSON {"message": "..."} (≤ 260 chars, may start with ⚠️).\nContext: ${JSON.stringify(context)}` },
      ],
      { temperature: 0.5, maxTokens: 250 }
    );
    const msg = typeof out.message === 'string' ? out.message.trim() : '';
    if (msg.length >= 10 && msg.length <= 320 && /[؀-ۿ]/.test(msg)) return { text: msg, usedFallback: false };
  } catch (e) {
    console.error('trend alert LLM failed:', e.message);
  }
  return { text: fallback, usedFallback: true };
}

/**
 * Build the report for this week ('current') or the latest week with data ('latest').
 * @returns {Promise<{text, report, week, prev, usedFallback, alert, snapshot, settings}>}
 */
async function buildAIReport(userId, which = 'current', now = new Date()) {
  const S = await loadStats();
  const C = await loadCoach();
  const settings = await coach.getSettings(userId);
  const [entries, checks] = await Promise.all([coach.getAllEntries(userId), coach.getAllChecks(userId)]);
  const today = S.localDate(now, settings.timezone || DEFAULT_TZ);
  const snapshot = S.buildSnapshot({ entries, checks, settings, today });
  let week = snapshot.thisWeek;
  let prev = snapshot.lastWeek;
  if (which === 'latest' && week.n_weighins === 0 && snapshot.lastWeek.n_weighins > 0) {
    week = snapshot.lastWeek;
    prev = snapshot.weekly.find((w) => w.week_start === S.addDays(week.week_start, -7)) || null;
  }
  const { name } = await ownerInfo(userId, settings);
  const context = C.buildContext({ entries, checks, settings, today, recentCoachMessages: await recentContents(userId), name });
  const { report, usedFallback } = await writeReport(C, context, week, { week, prev, settings });
  if (C.tooFast(snapshot.weekly) && report.watch_out.length < 2) {
    report.watch_out.push('تنزل بسرعة أكثر من ١٫٥ كيلو بالأسبوع. هدّها شوي وكل كفايتك.');
  }
  const text = C.renderReport(report, { week, prev, settings, snapshot });
  const alert = C.trendAlert(snapshot.weekly);
  return { text, report, week, prev, usedFallback, alert, snapshot, settings, context, C, today };
}

/** Send + log the weekly report (and a trend alert if due). Idempotent per week. */
async function sendWeeklyReport(bot, userId, now = new Date(), { dry = false } = {}) {
  const r = await buildAIReport(userId, 'current', now);
  const { authId } = await ownerInfo(userId, r.settings);
  const sent = [];
  const deliver = async (kind, text, data, usedFallback, url) => {
    if (dry) { console.log(`[DRY_RUN] ${userId} ${kind}: ${text}`); sent.push({ kind, text }); return; }
    const channels = [];
    try { await bot.telegram.sendMessage(userId, text); channels.push('telegram'); } catch (e) { console.error(`${kind} telegram failed:`, e.message); }
    if (authId) {
      const n = await push.sendToAuthUsers([authId], { title: 'مشبب', body: text.split('\n')[0].replace(/^📊 /, ''), url, tag: kind }).catch(() => 0);
      if (n > 0) channels.push('push');
    }
    await coach.logMessage({ userId, kind, content: text, data, channels, usedFallback, localDate: r.today, weekStart: r.week.week_start });
    sent.push({ kind, text });
  };
  await deliver('weekly_report', r.text, { report: r.report, week: r.week, prev: r.prev }, r.usedFallback, '/coach');

  if (r.alert && r.alert.week_start === r.week.week_start) {
    const { data: already } = await getSupabase().from('coach_messages').select('id')
      .eq('user_id', userId).eq('kind', 'trend_alert').eq('week_start', r.week.week_start).limit(1);
    if (!already?.length) {
      const t = await writeTrendText(r.C, r.context, r.alert, r.settings);
      await deliver('trend_alert', t.text, { alert: r.alert }, t.usedFallback, '/coach');
    }
  }
  return sent;
}

module.exports = { buildAIReport, sendWeeklyReport, loadCoach };
