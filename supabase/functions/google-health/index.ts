// google-health (D28): Google Health API link for steps + sleep (Fitbit → Google Health).
//   GET  ?start=<state>        → redirect to Google's consent screen (state from RPC create_google_state)
//   GET  ?code=…&state=…       → OAuth callback: store the refresh token, first sync, back to the app
//   POST (Bearer service key)  → sync every linked user (bot cron, every 20 min)
//   POST (Bearer user JWT)     → sync just that user (app open / «مزامنة الحين»)
// Deploy with --no-verify-jwt (the browser hits GET without a Supabase JWT); auth is checked here.
// Steps ≥ goal ticks «أقل شي». Never un-ticks anything.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.45.4';
import * as S from '../_shared/stats.mjs';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') || '';
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') || '';
const APP_URL = Deno.env.get('APP_URL') || 'https://mushabbab.faisalalthuwaini.sa';
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/google-health`;
const API = 'https://health.googleapis.com/v4/users/me/dataTypes';
const SCOPES = [
  'https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly',
  'https://www.googleapis.com/auth/googlehealth.sleep.readonly',
];

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
const back = (result: string, why = '') =>
  Response.redirect(`${APP_URL}/settings?google=${result}${why ? `&why=${encodeURIComponent(why.slice(0, 120))}` : ''}`, 302);

type Link = { user_id: number; refresh_token: string };
type Day = { steps: number | null; sleep: number | null; strength: number | null; workouts: { type: string; minutes: number; source: string }[]; spans: [number, number][] };

async function token(params: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`token ${res.status} ${body.error || ''} ${body.error_description || ''}`.trim());
  return body as { access_token: string; refresh_token?: string; scope?: string };
}

async function api(path: string, access: string, init: RequestInit = {}) {
  const res = await fetch(`${API}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${access}`, Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path.split('?')[0]} ${res.status} ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : {};
}

const civil = (day: string) => {
  const [year, month, d] = day.split('-').map(Number);
  return { date: { year, month, day: d }, time: { hours: 0, minutes: 0, seconds: 0, nanos: 0 } };
};
const ymd = (o: { year: number; month: number; day: number }) =>
  `${o.year}-${String(o.month).padStart(2, '0')}-${String(o.day).padStart(2, '0')}`;

/** Steps per local day + minutes asleep for sleep sessions that *ended* on each day. */
async function fetchDays(access: string, days: string[], tz: string): Promise<Record<string, Day>> {
  const out: Record<string, Day> = Object.fromEntries(days.map((d) => [d, { steps: null, sleep: null, strength: null, workouts: [], spans: [] }]));
  const first = days[0];
  const afterLast = S.addDays(days[days.length - 1], 1);

  const roll = await api('steps/dataPoints:dailyRollUp', access, {
    method: 'POST',
    body: JSON.stringify({ range: { start: civil(first), end: civil(afterLast) }, windowSizeDays: 1 }),
  });
  for (const p of roll.rollupDataPoints || []) {
    const d = p.civilStartTime?.date ? ymd(p.civilStartTime.date) : null;
    const n = Number(p.steps?.countSum ?? p.steps?.count ?? NaN);
    if (d && out[d] && Number.isFinite(n)) out[d].steps = Math.round(n);
  }

  const filter = `sleep.interval.civil_end_time >= "${first}T00:00:00" AND sleep.interval.civil_end_time < "${afterLast}T00:00:00"`;
  const sleep = await api(`sleep/dataPoints?pageSize=25&filter=${encodeURIComponent(filter)}`, access);
  for (const p of sleep.dataPoints || []) {
    const s = p.sleep;
    const end = s?.interval?.endTime;
    const mins = Number(s?.summary?.minutesAsleep ?? NaN);
    if (!end || !Number.isFinite(mins)) continue;
    const d = S.localDate(new Date(end), tz);
    if (out[d]) out[d].sleep = (out[d].sleep ?? 0) + Math.round(mins);
  }
  // Workouts (Hevy → Apple Health → Google Health). Shape probed generically; never breaks steps/sleep.
  try {
    const ef = `exercise.interval.civil_start_time >= "${first}" AND exercise.interval.civil_start_time < "${afterLast}"`;
    let pageToken = '';
    for (let i = 0; i < 4; i++) {
      const ex = await api(`exercise/dataPoints?pageSize=25&filter=${encodeURIComponent(ef)}${pageToken ? `&pageToken=${pageToken}` : ''}`, access);
      for (const p of ex.dataPoints || []) {
        const e = p.exercise || {};
        const start = e.interval?.startTime, end = e.interval?.endTime;
        if (!start) continue;
        const type = String(e.exerciseType ?? e.type ?? e.activityType ?? e.displayName ?? 'UNKNOWN');
        const active = Number(String(e.activeDuration ?? e.metricsSummary?.activeDuration ?? '').replace(/s$/, ''));
        const minutes = Math.round(Number.isFinite(active) && active > 0 ? active / 60 : end ? (Date.parse(end) - Date.parse(start)) / 60000 : 0);
        const d = S.localDate(new Date(start), tz);
        if (!out[d]) continue;
        const source = p.dataSource?.application?.packageName || p.dataSource?.device?.displayName || p.dataSource?.platform || '';
        out[d].workouts.push({ type, minutes, source });
        // The same session often arrives twice (Hevy via HealthKit + Fitbit auto-detect): keep spans, merge below.
        if (/STRENGTH|WEIGHT|LIFT|FUNCTIONAL|CROSS|RESISTANCE/i.test(type)) {
          const a = Date.parse(start), b = end ? Date.parse(end) : a + minutes * 60000;
          if (b > a) out[d].spans.push([a, b]);
        }
      }
      pageToken = ex.nextPageToken || '';
      if (!pageToken) break;
    }
  } catch (e) {
    console.error('google-health exercise', (e as Error).message);
  }
  for (const v of Object.values(out)) {
    if (!v.spans.length) continue;
    const spans = v.spans.sort((x, y) => x[0] - y[0]);
    let total = 0, [cs, ce] = spans[0];
    for (const [a, b] of spans.slice(1)) {
      if (a <= ce) ce = Math.max(ce, b);
      else { total += ce - cs; [cs, ce] = [a, b]; }
    }
    total += ce - cs;
    v.strength = Math.round(total / 60000);
  }
  return out;
}

async function syncUser(db: SupabaseClient, link: Link) {
  const { data: settings } = await db.from('coach_settings')
    .select('coach_enabled, timezone, steps_goal, strength_min_minutes').eq('user_id', link.user_id).maybeSingle();
  if (!settings?.coach_enabled) return { user_id: link.user_id, skipped: 'coach_off' };
  const tz = settings.timezone || 'Asia/Riyadh';
  const today = S.localDate(new Date(), tz);
  const days = [S.addDays(today, -1), today];
  const goal = settings.steps_goal ?? 6000;

  try {
    const { access_token } = await token({ grant_type: 'refresh_token', refresh_token: link.refresh_token });
    const got = await fetchDays(access_token, days, tz);
    const now = new Date().toISOString();
    for (const day of days) {
      const { steps, sleep, strength } = got[day];
      if (steps == null && sleep == null && strength == null) continue;
      const { data: cur } = await db.from('daily_checks').select('*').eq('user_id', link.user_id).eq('day', day).maybeSingle();
      const row = {
        user_id: link.user_id,
        day,
        minimum_done: !!cur?.minimum_done || (steps != null && steps >= goal),
        lifted: !!cur?.lifted || (strength != null && strength >= (settings.strength_min_minutes ?? 20)),
        workout_label: cur?.workout_label ?? null,
        ate_out: cur?.ate_out ?? null,
        steps: steps ?? cur?.steps ?? null,
        strength_minutes: strength ?? cur?.strength_minutes ?? null,
        sleep_minutes: sleep != null && sleep <= 960 ? sleep : cur?.sleep_minutes ?? null,
        health_synced_at: now,
        updated_at: now,
      };
      const { error } = await db.from('daily_checks').upsert(row, { onConflict: 'user_id,day' });
      if (error) throw new Error(`save ${error.message}`);
    }
    await db.from('google_health_links').update({ last_sync_at: now, last_error: null }).eq('user_id', link.user_id);
    return { user_id: link.user_id, ok: true, days: got };
  } catch (e) {
    const msg = (e as Error).message;
    console.error('google-health sync', link.user_id, msg);
    await db.from('google_health_links').update({ last_error: msg.slice(0, 300) }).eq('user_id', link.user_id);
    return { user_id: link.user_id, error: msg };
  }
}

/** The bot may hold the service key in another format (legacy JWT vs sb_secret_…): an admin call only works with one. */
async function isServiceKey(key: string) {
  if (key.split('.').length === 3 && !key.startsWith('sb_')) {
    try { if (JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role !== 'service_role') return false; } catch { return false; }
  }
  const { error } = await createClient(SUPABASE_URL, key, { auth: { persistSession: false } }).auth.admin.listUsers({ page: 1, perPage: 1 });
  return !error;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const url = new URL(req.url);

  if (req.method === 'GET') {
    if (!CLIENT_ID || !CLIENT_SECRET) return back('not_configured');
    const start = url.searchParams.get('start');
    if (start) {
      const { data: st } = await db.from('google_oauth_states').select('expires_at').eq('state', start).maybeSingle();
      if (!st || new Date(st.expires_at) < new Date()) return back('expired');
      const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      auth.search = new URLSearchParams({
        client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: SCOPES.join(' '),
        access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: start,
      }).toString();
      return Response.redirect(auth.toString(), 302);
    }
    if (url.searchParams.get('error')) return back('denied', url.searchParams.get('error')!);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    if (!code || !state) return back('error');
    const { data: st } = await db.from('google_oauth_states').delete().eq('state', state).select('user_id, expires_at').maybeSingle();
    if (!st || new Date(st.expires_at) < new Date()) return back('expired');
    try {
      const t = await token({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI });
      if (!t.refresh_token) return back('no_refresh');
      const { error } = await db.from('google_health_links').upsert(
        { user_id: st.user_id, refresh_token: t.refresh_token, scopes: t.scope ?? null, created_at: new Date().toISOString(), last_sync_at: null, last_error: null },
        { onConflict: 'user_id' },
      );
      if (error) throw new Error(error.message);
      const r = await syncUser(db, { user_id: st.user_id, refresh_token: t.refresh_token });
      return 'error' in r ? back('linked_sync_failed', r.error) : back('ok');
    } catch (e) {
      console.error('google-health callback', (e as Error).message);
      return back('error', (e as Error).message);
    }
  }

  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!bearer) return json({ error: 'unauthorized' }, 401);

  if (bearer === SERVICE_KEY || (await isServiceKey(bearer))) {
    const { data: links } = await db.from('google_health_links').select('user_id, refresh_token');
    const results = [];
    for (const l of (links || []) as Link[]) results.push(await syncUser(db, l));
    return json({ ok: true, results: results.map((r) => ({ user_id: r.user_id, ok: 'ok' in r, error: 'error' in r ? r.error : undefined, workouts: 'days' in r && r.days ? Object.fromEntries(Object.entries(r.days).map(([d, v]) => [d, v.workouts])) : undefined })) });
  }

  const { data: u } = await db.auth.getUser(bearer);
  if (!u?.user) return json({ error: 'unauthorized' }, 401);
  const { data: me } = await db.from('users').select('telegram_user_id').eq('auth_user_id', u.user.id).maybeSingle();
  if (!me) return json({ error: 'not_linked' }, 403);
  const { data: link } = await db.from('google_health_links').select('user_id, refresh_token').eq('user_id', me.telegram_user_id).maybeSingle();
  if (!link) return json({ error: 'not_connected' }, 404);
  const r = await syncUser(db, link as Link);
  return json('error' in r ? { ok: false, error: r.error } : { ok: true, days: (r as { days?: unknown }).days });
});
