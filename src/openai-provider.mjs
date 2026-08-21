const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';
const MAX_RETRIES = 2;
const MAX_TOTAL_WAIT_MS = 15_000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function retryDelayMs(response, raw = '') {
  const retryAfter = response?.headers?.get?.('retry-after');
  if (retryAfter !== null && retryAfter !== undefined && retryAfter !== '') {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000) + 250;
  }

  const reset = String(response?.headers?.get?.('x-ratelimit-reset-tokens') || '');
  const resetMatch = reset.match(/^([0-9.]+)s$/i);
  if (resetMatch) return Math.ceil(Number(resetMatch[1]) * 1000) + 250;

  const messageMatch = String(raw).match(/try again in\s+([0-9.]+)\s*(ms|s)/i);
  if (messageMatch) {
    const amount = Number(messageMatch[1]);
    return Math.ceil(messageMatch[2].toLowerCase() === 'ms' ? amount : amount * 1000) + 250;
  }

  return 1_500;
}

function extractOutputText(payload) {
  const direct = typeof payload?.output_text === 'string' ? payload.output_text : '';
  if (direct.trim()) return direct.trim();

  const chunks = [];
  for (const item of Array.isArray(payload?.output) ? payload.output : []) {
    for (const part of Array.isArray(item?.content) ? item.content : []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') chunks.push(part.text);
    }
  }
  return chunks.join('\n').trim();
}

function publicOpenAIError(response, payload, raw) {
  const message = String(payload?.error?.message || '').trim();
  const code = String(payload?.error?.code || '').trim();

  if (response.status === 401) return 'OpenAI rejected OPENAI_API_KEY.';
  if (response.status === 429 && /quota|billing|credit/i.test(`${message} ${code}`)) {
    return 'OpenAI API credit or quota is exhausted. Check billing/usage and try again.';
  }
  if (response.status === 429) return message ? `OpenAI rate limit: ${message.slice(0, 260)}` : 'OpenAI rate limit reached.';
  if (response.status === 400 && message) return `OpenAI rejected the request: ${message.slice(0, 260)}`;
  if (message) return `OpenAI request failed: ${message.slice(0, 260)}`;
  return `OpenAI request failed (${response.status}): ${String(raw || '').slice(0, 120)}`;
}

export async function openaiText({
  apiKey,
  model,
  instructions,
  input,
  reasoningEffort = 'low',
  maxOutputTokens = 2_400,
}) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured on the server.');
  if (!model) throw new Error('OpenAI model is required.');

  const body = {
    model,
    instructions,
    input,
    max_output_tokens: maxOutputTokens,
    store: false,
    reasoning: { effort: reasoningEffort },
  };

  let waitedMs = 0;
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(OPENAI_RESPONSES_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });

    const raw = await response.text();
    let payload = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }

    if (response.ok) {
      const content = extractOutputText(payload);
      if (!content) {
        const status = String(payload?.status || 'unknown');
        throw new Error(`OpenAI returned no usable text output (status: ${status}).`);
      }
      return { content, usage: payload?.usage ?? null, responseId: payload?.id ?? null };
    }

    if (response.status !== 429 || attempt >= MAX_RETRIES) {
      throw new Error(publicOpenAIError(response, payload, raw));
    }

    const remaining = MAX_TOTAL_WAIT_MS - waitedMs;
    if (remaining <= 0) throw new Error(publicOpenAIError(response, payload, raw));
    const waitMs = Math.max(250, Math.min(retryDelayMs(response, raw), remaining));
    waitedMs += waitMs;
    await sleep(waitMs);
  }
}

export const openaiProviderInternals = {
  extractOutputText,
  publicOpenAIError,
  retryDelayMs,
};
