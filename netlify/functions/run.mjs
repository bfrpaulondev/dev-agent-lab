import { runAgentPair } from '../../src/agents.mjs';
import { starterWorkspace } from '../../src/fixture.mjs';
import { assertSameOrigin, groqKey, json, parseBody, publicError, statusForError } from './_common.mjs';

const GROQ_API_PREFIX = 'https://api.groq.com/';
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_TOTAL_RATE_LIMIT_WAIT_MS = 15_000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function groqUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return typeof input?.url === 'string' ? input.url : '';
}

function prepareGroqInit(init = {}) {
  if (typeof init.body !== 'string') return init;
  let body;
  try { body = JSON.parse(init.body); } catch { return init; }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return init;

  if (!body.reasoning_effort) {
    if (body.model === 'qwen/qwen3.6-27b') body.reasoning_effort = 'none';
    if (String(body.model || '').startsWith('openai/gpt-oss-')) body.reasoning_effort = 'low';
  }

  return { ...init, body: JSON.stringify(body) };
}

function rateLimitDelayMs(response, raw = '') {
  const retryAfterHeader = response?.headers?.get?.('retry-after');
  if (retryAfterHeader !== null && retryAfterHeader !== undefined && retryAfterHeader !== '') {
    const retryAfter = Number(retryAfterHeader);
    if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.ceil(retryAfter * 1000) + 250;
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

async function withRateLimitAwareGroqFetch(run) {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  let waitedMs = 0;

  globalThis.fetch = async (input, init) => {
    if (!groqUrl(input).startsWith(GROQ_API_PREFIX)) return nativeFetch(input, init);
    const preparedInit = prepareGroqInit(init);

    for (let attempt = 0; ; attempt += 1) {
      const response = await nativeFetch(input, preparedInit);
      if (response.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) return response;

      const raw = await response.clone().text().catch(() => '');
      const requestedWait = rateLimitDelayMs(response, raw);
      const remainingBudget = MAX_TOTAL_RATE_LIMIT_WAIT_MS - waitedMs;
      if (remainingBudget <= 0) return response;

      const waitMs = Math.max(250, Math.min(requestedWait, remainingBudget));
      waitedMs += waitMs;
      await sleep(waitMs);
    }
  };

  try {
    return await run();
  } finally {
    globalThis.fetch = nativeFetch;
  }
}

export const handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  try {
    assertSameOrigin(event);
    const body = parseBody(event);
    const task = typeof body.task === 'string' ? body.task : '';
    const seed = body.files && typeof body.files === 'object' && !Array.isArray(body.files) ? body.files : starterWorkspace;
    const events = [{ type: 'run_start', startedAt: new Date().toISOString() }];
    const emit = payload => events.push(payload);
    const result = await withRateLimitAwareGroqFetch(() => runAgentPair({
      apiKey: groqKey(),
      task,
      seed,
      emit,
    }));
    events.push({ type: 'result', result });
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
      },
      body: `${events.map(item => JSON.stringify(item)).join('\n')}\n`,
    };
  } catch (error) {
    console.error('[agent-run]', error instanceof Error ? error.message : error);
    return json(statusForError(error), { error: publicError(error) });
  }
};

export const netlifyRunInternals = { prepareGroqInit, rateLimitDelayMs };
