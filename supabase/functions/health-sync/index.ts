// health-sync (D27): receives today's steps / strength-workout minutes / last night's sleep from an
// iPhone Shortcut (Apple Health ← Google Health/Fitbit, Hevy). Auth = the user's private token
// (Authorization: Bearer mh_…), not a Supabase JWT, so deploy with --no-verify-jwt.
// Reaching the step goal ticks «أقل شي»; a strength workout ≥ strength_min_minutes ticks «حديد».
// Never un-ticks anything the user marked by hand.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import * as S from '../_shared/stats.mjs';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Shortcuts send numbers as numbers, strings ("5,230", "٥٢٣٠") or empty — accept all. */
function num(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(S.normalizeDigits(String(v)).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Durations may arrive as minutes or seconds; > 600 can't be minutes for these fields. */
const toMinutes = (v: number | null, maxMinutes: number) => (v == null ? null : Math.round(v > maxMinutes ? v / 60 : v));

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { /* empty body is fine if token in header */ }

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim() || String(body.token || '').trim();
  if (!/^mh_[0-9a-f]{48}$/.test(token)) return json({ error: 'unauthorized' }, 401);

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { data: tok } = await db.from('health_tokens').select('user_id').eq('token_hash', await sha256(token)).maybeSingle();
  if (!tok) return json({ error: 'unauthorized' }, 401);
  const userId = tok.user_id as number;

  const { data: settings } = await db.from('coach_settings')
    .select('coach_enabled, timezone, steps_goal, strength_min_minutes').eq('user_id', userId).single();
  if (!settings?.coach_enabled) return json({ error: 'coach_not_enabled' }, 403);

  const today = S.localDate(new Date(), settings.timezone || 'Asia/Riyadh');
  let day = today;
  if (typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
    const diff = S.daysBetween(body.date, today);
    if (diff < 0 || diff > 1) return json({ error: 'date must be today or yesterday' }, 400);
    day = body.date;
  }

  const steps = num(body.steps);
  const strength = toMinutes(num(body.strength_minutes ?? body.strength ?? body.workout_minutes), 600);
  // Simpler signal for Shortcuts that can't read workout durations: how many Hevy samples
  // (e.g. its Active Energy entries) exist today, or an explicit lifted flag.
  const workouts = num(body.workouts ?? body.hevy);
  const liftedFlag = body.lifted === true || /^(1|true|yes|نعم)$/i.test(String(body.lifted ?? ''));
  const didLift = (strength != null && strength >= (settings.strength_min_minutes ?? 20)) || (workouts != null && workouts > 0) || liftedFlag;
  const sleepRaw = num(body.sleep_minutes ?? body.sleep);
  const sleepHours = num(body.sleep_hours);
  // Shortcuts may sum sleep durations as hours (7.2), minutes (432) or seconds (25920):
  // ≤ 24 can only be hours, > 1200 can only be seconds.
  let sleep = sleepHours != null ? Math.round(sleepHours * 60)
    : sleepRaw == null ? null
    : sleepRaw <= 24 ? Math.round(sleepRaw * 60)
    : sleepRaw > 1200 ? Math.round(sleepRaw / 60)
    : Math.round(sleepRaw);
  if (steps != null && (steps < 0 || steps > 150000)) return json({ error: 'steps out of range' }, 400);
  if (strength != null && strength > 600) return json({ error: 'strength minutes out of range' }, 400);
  // Without a «Value is Asleep» filter, In Bed + sleep stages overlap and the sum is inflated.
  // Sleep is display-only, so drop an implausible total instead of rejecting steps/workouts.
  if (sleep != null && (sleep < 0 || sleep > 960)) sleep = null;

  const { data: cur } = await db.from('daily_checks').select('*').eq('user_id', userId).eq('day', day).maybeSingle();
  const goal = settings.steps_goal ?? 6000;
  const row = {
    user_id: userId,
    day,
    minimum_done: !!cur?.minimum_done || (steps != null && steps >= goal),
    lifted: !!cur?.lifted || didLift,
    workout_label: cur?.workout_label ?? null,
    ate_out: cur?.ate_out ?? null,
    steps: steps != null ? Math.round(steps) : cur?.steps ?? null,
    strength_minutes: strength ?? cur?.strength_minutes ?? null,
    sleep_minutes: sleep ?? cur?.sleep_minutes ?? null,
    health_synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await db.from('daily_checks').upsert(row, { onConflict: 'user_id,day' });
  if (error) { console.error('upsert failed', error.message); return json({ error: 'save failed' }, 500); }
  await db.from('health_tokens').update({ last_used_at: new Date().toISOString() }).eq('user_id', userId);

  return json({
    ok: true, day,
    steps: row.steps, steps_goal: goal, minimum_done: row.minimum_done,
    strength_minutes: row.strength_minutes, lifted: row.lifted,
    sleep_minutes: row.sleep_minutes,
    message: row.minimum_done ? 'تم ✅ أقل شي محسوب' : `باقي ${Math.max(0, goal - (row.steps ?? 0))} خطوة`,
  });
});
