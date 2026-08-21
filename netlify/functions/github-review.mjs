import { runGitHubReviewStage, applySignedChanges } from '../../src/github-split-agents.mjs';
import { controlledGitHubTask } from '../../src/github-controlled-task.mjs';
import { verifyReviewStageToken } from '../../src/github-review-token.mjs';
import {
  createProposalToken,
  enforceGitHubWritePolicy,
  githubConfigured,
  loadRepositorySnapshot,
} from '../../src/github-runtime.mjs';
import { VirtualWorkspace } from '../../src/workspace.mjs';
import { assertSameOrigin, json, openaiKey, parseBody, publicError, statusForError } from './_common.mjs';

function qualityFindingKey(item) {
  return [item?.severity || '', item?.file || '', item?.message || ''].join('|');
}

function filterBaselineQuality(result, baselineQuality) {
  if (!result?.quality) return result;
  const baseline = new Set((baselineQuality?.findings || []).map(qualityFindingKey));
  const before = result.quality.findings || [];
  const findings = before.filter(item => !baseline.has(qualityFindingKey(item)));
  result.quality = {
    ...result.quality,
    findings,
    ok: !findings.some(item => item.severity === 'error'),
    baselineFindingsSuppressed: Math.max(0, before.length - findings.length),
  };
  return result;
}

export const handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  try {
    assertSameOrigin(event);
    if (!githubConfigured()) throw Object.assign(new Error('Controlled GitHub mode is not configured on the server.'), { statusCode: 503 });
    if (!openaiKey()) throw Object.assign(new Error('OPENAI_API_KEY is not configured on the server.'), { statusCode: 503 });

    const body = parseBody(event);
    const stage = verifyReviewStageToken(body.reviewToken);
    const snapshot = await loadRepositorySnapshot(stage.repo, stage.task);
    if (snapshot.baseBranch !== stage.baseBranch || snapshot.baseSha !== stage.baseSha || snapshot.baseTreeSha !== stage.baseTreeSha) {
      throw Object.assign(new Error('The base branch changed between DevAgent and ReviewerAgent. Run the task again.'), { statusCode: 409 });
    }

    const baselineQuality = new VirtualWorkspace(snapshot.files).qualityReport();
    const workspace = new VirtualWorkspace(snapshot.files);
    applySignedChanges(workspace, stage.changes);

    const events = [{
      type: 'cycle',
      cycle: 'review',
      message: 'DevAgent stage completed. ReviewerAgent is running in a separate bounded serverless invocation.',
      at: new Date().toISOString(),
    }];
    const emit = payload => events.push({ ...payload, at: new Date().toISOString() });
    const controlledTask = controlledGitHubTask(stage.task, snapshot);
    const { review, quality } = await runGitHubReviewStage({
      apiKey: openaiKey(),
      task: controlledTask,
      workspace,
      emit,
    });

    const result = {
      status: review.verdict === 'approve' ? 'approved' : 'changes_requested',
      task: stage.task,
      files: workspace.snapshot(),
      diff: workspace.diff(),
      quality,
      history: [{ cycle: 1, dev: stage.dev, review, quality }],
      operations: workspace.operations,
    };

    enforceGitHubWritePolicy(result, snapshot);
    filterBaselineQuality(result, baselineQuality);
    const proposalToken = createProposalToken(snapshot, stage.task, result);
    result.github = {
      repo: snapshot.repo,
      baseBranch: snapshot.baseBranch,
      baseSha: snapshot.baseSha,
      snapshotFiles: Object.keys(snapshot.files).length,
      snapshotBytes: snapshot.snapshotBytes,
      proposalReady: Boolean(proposalToken),
      splitExecution: true,
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
    console.error('[github-agent-review]', error instanceof Error ? error.message : error);
    return json(statusForError(error), { error: publicError(error) });
  }
};

export const githubReviewInternals = { filterBaselineQuality, qualityFindingKey };
