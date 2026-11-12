const { getSupabase } = require('../supabase.js');
const { loadStats, DEFAULT_TZ } = require('../shared.js');

// All dates are local calendar dates in Riyadh (DECISIONS.md D3); weeks are Sunday–Saturday (D2).

/** Riyadh-local 'YYYY-MM-DD' for a Date (or today). Synchronous so existing callers keep working. */
function toDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: DEFAULT_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Sunday of the week containing `d` (local), as 'YYYY-MM-DD'. */
async function startOfWeek(d = new Date()) {
  const S = await loadStats();
  return S.weekStart(toDateString(d), 0);
}

async function ensureUser(supabase, telegramUserId, from) {
  const { data: existing } = await supabase
    .from('users')
    .select('telegram_user_id')
    .eq('telegram_user_id', String(telegramUserId))
    .single();

  if (existing) {
    await supabase
      .from('users')
      .update({
        username: from.username || null,
        first_name: from.first_name || null,
        last_name: from.last_name || null,
        updated_at: new Date().toISOString(),
      })
      .eq('telegram_user_id', String(telegramUserId));
    return;
  }

  await supabase.from('users').insert({
    telegram_user_id: telegramUserId,
    username: from.username || null,
    first_name: from.first_name || null,
    last_name: from.last_name || null,
  });
}

async function upsertWeight(telegramUserId, weightKg, recordedDate, source = 'telegram') {
  const supabase = getSupabase();
  const dateStr = typeof recordedDate === 'string' ? recordedDate : toDateString(recordedDate);

  const { error } = await supabase.from('weight_entries').upsert(
    {
      user_id: telegramUserId,
      weight: parseFloat(weightKg),
      recorded_at: dateStr,
      source,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,recorded_at' }
  );

  if (error) throw error;
}

async function getRecentEntries(telegramUserId, days = 14) {
  const S = await loadStats();
  const supabase = getSupabase();
  const end = toDateString(new Date());
  const start = S.addDays(end, -days);

  const { data, error } = await supabase
    .from('weight_entries')
    .select('weight, recorded_at')
    .eq('user_id', telegramUserId)
    .gte('recorded_at', start)
    .lte('recorded_at', end)
    .order('recorded_at', { ascending: true });

  if (error) throw error;
  return (data || []).map((r) => ({ date: r.recorded_at, weight: Number(r.weight) }));
}

async function getWeeklyAverages(telegramUserId) {
  const S = await loadStats();
  const supabase = getSupabase();
  const thisWeekStart = S.weekStart(toDateString(new Date()), 0);
  const nextWeekStart = S.addDays(thisWeekStart, 7);
  const lastWeekStart = S.addDays(thisWeekStart, -7);

  const { data, error } = await supabase
    .from('weight_entries')
    .select('weight, recorded_at')
    .eq('user_id', telegramUserId)
    .gte('recorded_at', lastWeekStart)
    .lt('recorded_at', nextWeekStart);
  if (error) throw error;

  const rows = data || [];
  const thisWeek = rows.filter((r) => r.recorded_at >= thisWeekStart).map((r) => r.weight);
  const lastWeek = rows.filter((r) => r.recorded_at < thisWeekStart).map((r) => r.weight);

  return {
    thisWeekAvg: S.average(thisWeek),
    lastWeekAvg: S.average(lastWeek),
    thisWeekCount: thisWeek.length,
    lastWeekCount: lastWeek.length,
  };
}

async function getDayOverDay(telegramUserId) {
  const entries = await getRecentEntries(telegramUserId, 14);
  if (entries.length < 2) return { earlier: null, later: null };
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
  const earlier = sorted[sorted.length - 2];
  const later = sorted[sorted.length - 1];
  return { earlier, later };
}

async function getTodayWeight(telegramUserId) {
  const today = toDateString(new Date());
  const entries = await getRecentEntries(telegramUserId, 1);
  const found = entries.find((e) => e.date === today);
  return found ? found.weight : null;
}

async function getUsersWithReminderDue(hour, minute) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('users')
    .select('telegram_user_id, reminder_time')
    .eq('reminder_enabled', true)
    .not('reminder_time', 'is', null);

  if (error) throw error;
  if (!data || data.length === 0) return [];

  return data
    .filter((u) => {
      const [h, m] = (u.reminder_time || '').split(':').map(Number);
      return h === hour && m === minute;
    })
    .map((u) => u.telegram_user_id);
}

async function getAllUserIds() {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('users')
    .select('telegram_user_id');

  if (error) throw error;
  if (!data || data.length === 0) return [];
  return data.map((u) => u.telegram_user_id);
}

module.exports = {
  ensureUser,
  upsertWeight,
  getRecentEntries,
  getWeeklyAverages,
  getDayOverDay,
  getTodayWeight,
  getUsersWithReminderDue,
  getAllUserIds,
  toDateString,
  startOfWeek,
};
