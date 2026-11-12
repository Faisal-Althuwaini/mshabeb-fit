// Data access for the coaching layer: settings, daily checks, snapshots, message log, linking.
const { getSupabase } = require('../supabase.js');
const { loadStats, DEFAULT_TZ } = require('../shared.js');

async function getSettings(userId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('coach_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: created, error: insErr } = await supabase
    .from('coach_settings')
    .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: false })
    .select('*')
    .single();
  if (insErr) throw insErr;
  return created;
}

/** Read-only check (never creates a row). DECISIONS.md D12. */
async function isCoachEnabled(userId) {
  const { data, error } = await getSupabase()
    .from('coach_settings')
    .select('coach_enabled')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return !!data?.coach_enabled;
}

async function updateSettings(userId, patch) {
  const { error } = await getSupabase()
    .from('coach_settings')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) throw error;
}

async function todayFor(settings, now = new Date()) {
  const S = await loadStats();
  return S.localDate(now, settings?.timezone || DEFAULT_TZ);
}

/** Merge fields into today's (or `day`'s) daily_checks row. */
async function upsertCheck(userId, day, patch) {
  const supabase = getSupabase();
  const { data: existing, error: selErr } = await supabase
    .from('daily_checks')
    .select('*')
    .eq('user_id', userId)
    .eq('day', day)
    .maybeSingle();
  if (selErr) throw selErr;

  const row = {
    minimum_done: false,
    lifted: false,
    workout_label: null,
    ate_out: null,
    ...(existing || {}),
    ...patch,
    user_id: userId,
    day,
    updated_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('daily_checks').upsert(row, { onConflict: 'user_id,day' });
  if (error) throw error;
  return row;
}

async function getAllEntries(userId) {
  const { data, error } = await getSupabase()
    .from('weight_entries')
    .select('weight, recorded_at')
    .eq('user_id', userId)
    .order('recorded_at', { ascending: true });
  if (error) throw error;
  return (data || []).map((r) => ({ date: r.recorded_at, weight: Number(r.weight) }));
}

async function getAllChecks(userId) {
  const { data, error } = await getSupabase()
    .from('daily_checks')
    .select('day, minimum_done, lifted, workout_label, ate_out')
    .eq('user_id', userId)
    .order('day', { ascending: true });
  if (error) throw error;
  return data || [];
}

/** Full stats snapshot for a user (see shared/stats.mjs buildSnapshot). */
async function getSnapshot(userId, now = new Date()) {
  const S = await loadStats();
  const settings = await getSettings(userId);
  const [entries, checks] = await Promise.all([getAllEntries(userId), getAllChecks(userId)]);
  const today = S.localDate(now, settings.timezone || DEFAULT_TZ);
  return { settings, snapshot: S.buildSnapshot({ entries, checks, settings, today }) };
}

async function isPaused(userId, now = new Date()) {
  const settings = await getSettings(userId);
  if (!settings.paused_until) return false;
  return settings.paused_until >= (await todayFor(settings, now));
}

async function logMessage({ userId, kind, content, data = null, channels = [], usedFallback = false, localDate = null, weekStart = null }) {
  const { error } = await getSupabase().from('coach_messages').insert({
    user_id: userId,
    kind,
    content,
    data,
    channels,
    used_fallback: usedFallback,
    local_date: localDate,
    week_start: weekStart,
  });
  if (error) console.error('coach_messages insert error:', error.message);
}

/**
 * Consume a PWA link code and attach the auth account to this Telegram user.
 * @returns {'ok' | 'invalid' | 'expired' | 'taken'}
 */
async function consumeLinkCode(code, telegramUserId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('link_codes')
    .select('code, auth_user_id, expires_at')
    .eq('code', code)
    .maybeSingle();
  if (error) throw error;
  if (!data) return 'invalid';
  if (new Date(data.expires_at) < new Date()) {
    await supabase.from('link_codes').delete().eq('code', code);
    return 'expired';
  }

  const { data: other } = await supabase
    .from('users')
    .select('telegram_user_id')
    .eq('auth_user_id', data.auth_user_id)
    .neq('telegram_user_id', telegramUserId)
    .maybeSingle();
  if (other) return 'taken';

  const { error: upErr } = await supabase
    .from('users')
    .update({ auth_user_id: data.auth_user_id, updated_at: new Date().toISOString() })
    .eq('telegram_user_id', telegramUserId);
  if (upErr) throw upErr;
  await supabase.from('link_codes').delete().eq('code', code);
  return 'ok';
}

module.exports = {
  getSettings,
  isCoachEnabled,
  updateSettings,
  todayFor,
  upsertCheck,
  getAllEntries,
  getAllChecks,
  getSnapshot,
  isPaused,
  logMessage,
  consumeLinkCode,
};
