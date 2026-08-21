import { runAgentPair } from '../../src/agents.mjs';
import { starterWorkspace } from '../../src/fixture.mjs';
import { assertSameOrigin, groqKey, json, parseBody, publicError, statusForError } from './_common.mjs';

export const handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  try {
    assertSameOrigin(event);
    const body = parseBody(event);
    const task = typeof body.task === 'string' ? body.task : '';
    const seed = body.files && typeof body.files === 'object' && !Array.isArray(body.files) ? body.files : starterWorkspace;
    const events = [{ type: 'run_start', startedAt: new Date().toISOString() }];
    const emit = payload => events.push(payload);
    const result = await runAgentPair({
      apiKey: groqKey(),
      task,
      seed,
      emit,
    });
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
