import { runCompactAgentPair } from '../../src/compact-agents.mjs';
import {
  createProposalToken,
  enforceGitHubWritePolicy,
  githubConfigured,
  loadRepositorySnapshot,
} from '../../src/github-runtime.mjs';
import { assertSameOrigin, groqKey, json, parseBody, publicError, statusForError } from './_common.mjs';

const GROQ_API_PREFIX = 'https://api.groq.com/';
const MAX_RATE_LIMIT_RETRIES = 2;
const MAX_TOTAL_RATE_LIMIT_WAIT_MS = 15_000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function groqUrl(input) {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return typeof input?.url === 'string' ? input.url : '';
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
    for (let attempt = 0; ; attempt += 1) {
      const response = await nativeFetch(input, init);
      if (response.status !== 429 || attempt >= MAX_RATE_LIMIT_RETRIES) return response;
      const raw = await response.clone().text().catch(() => '');
      const remaining = MAX_TOTAL_RATE_LIMIT_WAIT_MS - waitedMs;
      if (remaining <= 0) return response;
      const waitMs = Math.max(250, Math.min(rateLimitDelayMs(response, raw), remaining));
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
    if (!githubConfigured()) throw Object.assign(new Error('Controlled GitHub mode is not configured on the server.'), { statusCode: 503 });
    if (!groqKey()) throw Object.assign(new Error('GROQ_API_KEY is not configured on the server.'), { statusCode: 503 });

    const body = parseBody(event);
    const task = typeof body.task === 'string' ? body.task.trim() : '';
    const repo = typeof body.repo === 'string' ? body.repo : '';
    if (!task || task.length > 5_000) throw Object.assign(new Error('Task must be between 1 and 5000 characters for GitHub mode.'), { statusCode: 400 });

    const snapshot = await loadRepositorySnapshot(repo, task);
    const events = [{
      type: 'run_start',
      startedAt: new Date().toISOString(),
      mode: 'github-controlled',
      repo: snapshot.repo,
      baseBranch: snapshot.baseBranch,
      snapshotFiles: Object.keys(snapshot.files).length,
    }];
    const emit = payload => events.push({ ...payload, at: new Date().toISOString() });

    const controlledTask = `${task}\n\nCONTROLLED GITHUB MODE:\n- You are editing a bounded, task-relevant snapshot from ${snapshot.repo}@${snapshot.baseBranch}; unseen repository files may exist.\n- Do not modify AGENTS.md, .github/, CI/workflows, hosting/infra configuration, secrets, credentials, or environment files.\n- Do not claim that shell tests, builds, deployment, merge, database operations, or external actions ran. Only deterministic workspace checks and ReviewerAgent review are available in this phase.\n- Prefer the smallest coherent change that can be justified from the visible snapshot.`;

    const result = await withRateLimitAwareGroqFetch(() => runCompactAgentPair({
      apiKey: groqKey(),
      task: controlledTask,
      seed: snapshot.files,
      emit,
    }));

    enforceGitHubWritePolicy(result, snapshot);
    const proposalToken = createProposalToken(snapshot, task, result);

    result.github = {
      repo: snapshot.repo,
      baseBranch: snapshot.baseBranch,
      baseSha: snapshot.baseSha,
      snapshotFiles: Object.keys(snapshot.files).length,
      snapshotBytes: snapshot.snapshotBytes,
      proposalReady: Boolean(proposalToken),
      restrictions: ['agent/* branch only', 'no main writes', 'no merge', 'no deploy', 'no secrets', 'protected paths blocked'],
    };
    result.proposalToken = proposalToken;
    events.push({ type: 'result', result, at: new Date().toISOString() });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
      },
      body: `${events.map(item => JSON.stringify(item)).join('\n')}\n`,
    };
  } catch (error) {
    console.error('[github-agent-run]', error instanceof Error ? error.message : error);
    return json(statusForError(error), { error: publicError(error) });
  }
};

export const githubRunInternals = { rateLimitDelayMs };
