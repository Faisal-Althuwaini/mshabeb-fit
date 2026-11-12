// LLM client (OpenAI-compatible chat completions). Server-side only. DECISIONS.md D20.
// Default: OpenRouter with DeepSeek V4.1 Flash, falling back to gpt-oss-120b inside the same
// request (OpenRouter `models` list). If both fail, callers fall back to templates.
//
//   OPENROUTER_API_KEY   required to enable the LLM (unset → templates only, old behaviour)
//   LLM_MODEL            default deepseek/deepseek-v4.1-flash
//   LLM_FALLBACK_MODELS  comma-separated, default openai/gpt-oss-120b ("" to disable)
//   LLM_BASE_URL         default https://openrouter.ai/api/v1
const TIMEOUT_MS = 8000;

const cfg = () => ({
  key: process.env.OPENROUTER_API_KEY || '',
  baseUrl: process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1',
  model: process.env.LLM_MODEL || 'deepseek/deepseek-v4.1-flash',
  fallbacks: (process.env.LLM_FALLBACK_MODELS ?? 'openai/gpt-oss-120b')
    .split(',').map((s) => s.trim()).filter(Boolean),
});

function isEnabled() {
  return !!cfg().key;
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
  const c = cfg();
  if (!c.key) throw new Error('OPENROUTER_API_KEY not set');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const body = {
      model: c.model,
      messages,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    };
    if (c.fallbacks.length) body.models = [c.model, ...c.fallbacks]; // OpenRouter model fallback
    const res = await fetch(`${c.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${c.key}`,
        'X-Title': 'Mushabbab',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    const content = json.choices?.[0]?.message?.content;
    const parsed = extractJson(content);
    if (!parsed || typeof parsed !== 'object') throw new Error('LLM returned non-JSON');
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { isEnabled, chatJson, extractJson, config: cfg };
