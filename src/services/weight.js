const { getSupabase } = require('../supabase.js');

function startOfWeek(d) {
  const date = new Date(d);
  const day = date.getUTCDay();
  const diff = date.getUTCDate() - day + (day === 0 ? -6 : 1);
  date.setUTCDate(diff);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function toDateString(date) {
  return date.toISOString().slice(0, 10);
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

async function upsertWeight(telegramUserId, weightKg, recordedDate) {
  const supabase = getSupabase();
  const dateStr = typeof recordedDate === 'string' ? recordedDate : toDateString(recordedDate);

  const { error } = await supabase.from('weight_entries').upsert(
    {
      user_id: telegramUserId,
      weight: parseFloat(weightKg),
      recorded_at: dateStr,
      created_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,recorded_at' }
  );

  if (error) throw error;
}

async function getRecentEntries(telegramUserId, days = 14) {
  const supabase = getSupabase();
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  start.setUTCHours(0, 0, 0, 0);

  const { data, error } = await supabase
    .from('weight_entries')
    .select('weight, recorded_at')
    .eq('user_id', telegramUserId)
    .gte('recorded_at', toDateString(start))
    .lte('recorded_at', toDateString(end))
    .order('recorded_at', { ascending: true });

  if (error) throw error;
  return (data || []).map((r) => ({ date: r.recorded_at, weight: Number(r.weight) }));
}

async function getWeeklyAverages(telegramUserId) {
  const supabase = getSupabase();
  const now = new Date();
  const thisWeekStart = startOfWeek(now);
  const nextWeekStart = new Date(thisWeekStart);
  nextWeekStart.setUTCDate(nextWeekStart.getUTCDate() + 7);
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setUTCDate(lastWeekStart.getUTCDate() - 7);

  const { data: thisWeek } = await supabase
    .from('weight_entries')
    .select('weight')
    .eq('user_id', telegramUserId)
    .gte('recorded_at', toDateString(thisWeekStart))
    .lt('recorded_at', toDateString(nextWeekStart));

  const { data: lastWeek } = await supabase
    .from('weight_entries')
    .select('weight')
    .eq('user_id', telegramUserId)
    .gte('recorded_at', toDateString(lastWeekStart))
    .lt('recorded_at', toDateString(thisWeekStart));

  const avg = (rows) => {
    if (!rows || rows.length === 0) return null;
    const sum = rows.reduce((s, r) => s + Number(r.weight), 0);
    return Math.round((sum / rows.length) * 10) / 10;
  };

  return {
    thisWeekAvg: avg(thisWeek),
    lastWeekAvg: avg(lastWeek),
    thisWeekCount: (thisWeek || []).length,
    lastWeekCount: (lastWeek || []).length,
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

  const targetMinutes = hour * 60 + minute;
  return data
    .filter((u) => {
      const [h, m] = (u.reminder_time || '').split(':').map(Number);
      return h === hour && m === minute;
    })
    .map((u) => u.telegram_user_id);
}

module.exports = {
  ensureUser,
  upsertWeight,
  getRecentEntries,
  getWeeklyAverages,
  getDayOverDay,
  getTodayWeight,
  getUsersWithReminderDue,
  toDateString,
  startOfWeek,
};
