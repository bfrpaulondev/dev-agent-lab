import { runCompactAgentPair } from '../../src/compact-agents.mjs';
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
  const findings = (result.quality.findings || []).filter(item => !baseline.has(qualityFindingKey(item)));
  result.quality = {
    ...result.quality,
    findings,
    ok: !findings.some(item => item.severity === 'error'),
    baselineFindingsSuppressed: Math.max(0, (result.quality.findings || []).length - findings.length),
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
    const task = typeof body.task === 'string' ? body.task.trim() : '';
    const repo = typeof body.repo === 'string' ? body.repo : '';
    if (!task || task.length > 5_000) throw Object.assign(new Error('Task must be between 1 and 5000 characters for GitHub mode.'), { statusCode: 400 });

    const snapshot = await loadRepositorySnapshot(repo, task);
    const baselineQuality = new VirtualWorkspace(snapshot.files).qualityReport();
    const events = [{
      type: 'run_start',
      startedAt: new Date().toISOString(),
      mode: 'github-controlled',
      provider: 'openai',
      repo: snapshot.repo,
      baseBranch: snapshot.baseBranch,
      snapshotFiles: Object.keys(snapshot.files).length,
    }];
    const emit = payload => events.push({ ...payload, at: new Date().toISOString() });

    const controlledTask = `${task}\n\nCONTROLLED GITHUB MODE:\n- You are editing a bounded, task-relevant snapshot from ${snapshot.repo}@${snapshot.baseBranch}; unseen repository files may exist.\n- Do not modify AGENTS.md, .github/, CI/workflows, hosting/infra configuration, secrets, credentials, or environment files.\n- Do not claim that shell tests, builds, deployment, merge, database operations, or external actions ran. Only deterministic workspace checks and ReviewerAgent review are available in this phase.\n- Prefer the smallest coherent change that can be justified from the visible snapshot.`;

    const result = await runCompactAgentPair({
      apiKey: openaiKey(),
      task: controlledTask,
      seed: snapshot.files,
      emit,
    });

    enforceGitHubWritePolicy(result, snapshot);
    filterBaselineQuality(result, baselineQuality);
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

export const githubRunInternals = { filterBaselineQuality, qualityFindingKey };
