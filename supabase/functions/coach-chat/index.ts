// coach-chat: chat with مشبب from the PWA (plan §6.5). Requires the user's JWT (verify_jwt on).
// Context = shared buildContext + the last 10 chat turns. 30 messages a day. Plain-text replies.
// Secrets: OPENROUTER_API_KEY (unset → friendly fallback), optional LLM_MODEL / LLM_FALLBACK_MODELS.
import { createClient } from 'npm:@supabase/supabase-js@2.45.4';
import * as S from '../_shared/stats.mjs';
import { SYSTEM_PROMPT, buildContext } from '../_shared/coach.mjs';

const DAILY_LIMIT = 30;
const ALLOWED_ORIGINS = ['https://mushabbab.faisalalthuwaini.sa', 'http://localhost:5173'];

const cors = (origin: string | null) => ({
  'Access-Control-Allow-Origin': origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
});

const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), 'Content-Type': 'application/json' } });

const CHAT_RULES = `\nYou are chatting inside his app. Reply in 1–4 short sentences of Saudi dialect. Use his numbers from the context when relevant. Plain text, no markdown headings, at most one emoji.`;

async function askLLM(messages: { role: string; content: string }[]): Promise<string | null> {
  const key = Deno.env.get('OPENROUTER_API_KEY');
  if (!key) return null;
  const model = Deno.env.get('LLM_MODEL') || 'deepseek/deepseek-v4.1-flash';
  const fallbacks = (Deno.env.get('LLM_FALLBACK_MODELS') ?? 'openai/gpt-oss-120b').split(',').map((s) => s.trim()).filter(Boolean);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'X-Title': 'Mushabbab' },
      body: JSON.stringify({ model, models: fallbacks.length ? [model, ...fallbacks] : undefined, messages, temperature: 0.6, max_tokens: 400 }),
      signal: ctrl.signal,
    });
    if (!res.ok) { console.error('LLM HTTP', res.status, (await res.text()).slice(0, 200)); return null; }
    const out = await res.json();
    const text = out.choices?.[0]?.message?.content?.trim();
    return text && /[؀-ۿ]/.test(text) ? text.slice(0, 1200) : null;
  } catch (e) {
    console.error('LLM error', (e as Error).message);
    return null;
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(origin) });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, origin);

  const auth = req.headers.get('Authorization') || '';
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  });

  const { data: who, error: whoErr } = await db.rpc('whoami');
  if (whoErr || !who?.telegram_user_id || !who.coach_enabled) return json({ error: 'coach_not_enabled' }, 403, origin);
  const userId = who.telegram_user_id as number;

  let message = '';
  try { message = String((await req.json()).message || '').trim(); } catch { /* bad body */ }
  if (message.length < 1 || message.length > 1000) return json({ error: 'message must be 1–1000 characters' }, 400, origin);

  const { data: settings } = await db.from('coach_settings').select('*').eq('user_id', userId).single();
  const tz = settings?.timezone || 'Asia/Riyadh';
  const today = S.localDate(new Date(), tz);

  const { count } = await db.from('coach_messages').select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('kind', 'chat_user').eq('local_date', today);
  if ((count ?? 0) >= DAILY_LIMIT) {
    return json({ reply: 'خلصنا رسايل اليوم (٣٠) 😄 نكمل بكرة. وأقل شي اليوم لا يفوتك.', remaining: 0, limited: true }, 429, origin);
  }

  const [w, c, hist, recent] = await Promise.all([
    db.from('weight_entries').select('weight, recorded_at').eq('user_id', userId).order('recorded_at'),
    db.from('daily_checks').select('day, minimum_done, lifted, workout_label').eq('user_id', userId).order('day'),
    db.from('coach_messages').select('kind, content').eq('user_id', userId).in('kind', ['chat_user', 'chat_coach'])
      .order('created_at', { ascending: false }).limit(10),
    db.from('coach_messages').select('content').eq('user_id', userId).not('kind', 'in', '(chat_user,chat_coach)')
      .order('created_at', { ascending: false }).limit(3),
  ]);
  const entries = (w.data || []).map((r: { weight: number | string; recorded_at: string }) => ({ date: r.recorded_at, weight: Number(r.weight) }));
  const context = buildContext({
    entries, checks: c.data || [], settings, today,
    recentCoachMessages: (recent.data || []).map((r: { content: string }) => r.content),
    name: who.first_name,
  });
  const history = (hist.data || []).reverse().map((m: { kind: string; content: string }) => ({
    role: m.kind === 'chat_user' ? 'user' : 'assistant', content: m.content,
  }));

  const reply = await askLLM([
    { role: 'system', content: SYSTEM_PROMPT + CHAT_RULES + `\nContext (JSON): ${JSON.stringify(context)}` },
    ...history,
    { role: 'user', content: message },
  ]);
  const usedFallback = reply == null;
  const text = reply ?? 'مشبب ما يقدر يرد الحين 🙏 جرّب بعد شوي. وتذكّر: أقل شي يكفي.';

  await db.from('coach_messages').insert([
    { user_id: userId, kind: 'chat_user', content: message, local_date: today, channels: ['pwa'] },
    { user_id: userId, kind: 'chat_coach', content: text, local_date: today, channels: ['pwa'], used_fallback: usedFallback },
  ]);
  return json({ reply: text, remaining: DAILY_LIMIT - (count ?? 0) - 1, usedFallback }, 200, origin);
});
