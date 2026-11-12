// Minimal DeepSeek client (OpenAI-compatible). Server-side only. DECISIONS.md D11.
const BASE_URL = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
const TIMEOUT_MS = 8000;

function isEnabled() {
  return !!process.env.DEEPSEEK_API_KEY;
}

/** Pull the first {...} object out of a model reply and parse it. Returns null on failure. */
function extractJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_) {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    try {
      return JSON.parse(m[0]);
    } catch (_) {
      return null;
    }
  }
}

/**
 * Chat completion that must return a JSON object.
 * Throws on network error / timeout / non-2xx / unparseable output so callers can fall back.
 */
async function chatJson(messages, { temperature = 0.2, maxTokens = 400, timeoutMs = TIMEOUT_MS } = {}) {
  if (!isEnabled()) throw new Error('DEEPSEEK_API_KEY not set');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`DeepSeek HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content;
    const parsed = extractJson(content);
    if (!parsed || typeof parsed !== 'object') throw new Error('DeepSeek returned non-JSON');
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isEnabled, chatJson, extractJson, MODEL };
