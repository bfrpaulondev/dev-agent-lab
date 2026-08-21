import { runGitHubDevStage } from '../../src/github-split-agents.mjs';
import { controlledGitHubTask } from '../../src/github-controlled-task.mjs';
import { createReviewStageToken } from '../../src/github-review-token.mjs';
import { githubConfigured, loadRepositorySnapshot } from '../../src/github-runtime.mjs';
import { assertSameOrigin, json, openaiKey, parseBody, publicError, statusForError } from './_common.mjs';

export const handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  try {
    assertSameOrigin(event);
    if (!githubConfigured()) throw Object.assign(new Error('Controlled GitHub mode is not configured on the server.'), { statusCode: 503 });
    if (!openaiKey()) throw Object.assign(new Error('OPENAI_API_KEY is not configured on the server.'), { statusCode: 503 });

    const body = parseBody(event);
    const task = typeof body.task === 'string' ? body.task.trim() : '';
    const repo = typeof body.repo === 'string' ? body.repo : '';
    if (!task || task.length > 5_000) throw Object.assign(new Error('Task must be between 1 and 5000 characters for GitHub mode.'), { statusCode: 400 });

    const snapshot = await loadRepositorySnapshot(repo, task);
    const events = [{
      type: 'run_start',
      startedAt: new Date().toISOString(),
      mode: 'github-controlled',
      phase: 'dev',
      provider: 'openai',
      repo: snapshot.repo,
      baseBranch: snapshot.baseBranch,
      snapshotFiles: Object.keys(snapshot.files).length,
    }];
    const emit = payload => events.push({ ...payload, at: new Date().toISOString() });

    const controlledTask = controlledGitHubTask(task, snapshot);
    const devResult = await runGitHubDevStage({
      apiKey: openaiKey(),
      task: controlledTask,
      seed: snapshot.files,
      emit,
    });

    const reviewToken = createReviewStageToken(snapshot, task, devResult);
    events.push({
      type: 'review_stage_ready',
      reviewToken,
      github: {
        repo: snapshot.repo,
        baseBranch: snapshot.baseBranch,
        baseSha: snapshot.baseSha,
        snapshotFiles: Object.keys(snapshot.files).length,
        snapshotBytes: snapshot.snapshotBytes,
      },
      at: new Date().toISOString(),
    });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
      },
      body: `${events.map(item => JSON.stringify(item)).join('\n')}\n`,
    };
  } catch (error) {
    console.error('[github-agent-dev]', error instanceof Error ? error.message : error);
    return json(statusForError(error), { error: publicError(error) });
  }
};
