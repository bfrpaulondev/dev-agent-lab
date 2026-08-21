import { runCompactAgentPair } from '../../src/compact-agents.mjs';
import { enforceExternalEffectsTruthfulness, taskWithExternalEffectsPolicy } from '../../src/external-effects-policy.mjs';
import { starterWorkspace } from '../../src/fixture.mjs';
import { assertSameOrigin, json, openaiKey, parseBody, publicError, statusForError } from './_common.mjs';

export const handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  try {
    assertSameOrigin(event);
    if (!openaiKey()) throw Object.assign(new Error('OPENAI_API_KEY is not configured on the server.'), { statusCode: 503 });

    const body = parseBody(event);
    const task = typeof body.task === 'string' ? body.task : '';
    const seed = body.files && typeof body.files === 'object' && !Array.isArray(body.files) ? body.files : starterWorkspace;
    const events = [{ type: 'run_start', startedAt: new Date().toISOString(), mode: 'compact-openai' }];
    const emit = payload => events.push(payload);
    const protectedTask = taskWithExternalEffectsPolicy(task);
    const rawResult = await runCompactAgentPair({
      apiKey: openaiKey(),
      task: protectedTask,
      seed,
      emit,
    });
    const previousStatus = rawResult.status;
    const result = enforceExternalEffectsTruthfulness(rawResult, task);
    if (previousStatus === 'approved' && result.status === 'changes_requested') {
      events.push({
        type: 'cycle',
        cycle: 'policy',
        message: 'Product-truthfulness gate rejected a simulated external success state.',
      });
    }
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
