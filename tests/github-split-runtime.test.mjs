import test from 'node:test';
import assert from 'node:assert/strict';
import { createReviewStageToken, verifyReviewStageToken } from '../src/github-review-token.mjs';
import { applySignedChanges } from '../src/github-split-agents.mjs';
import { VirtualWorkspace } from '../src/workspace.mjs';
import { commonInternals } from '../netlify/functions/_common.mjs';
import { openaiProviderInternals } from '../src/openai-provider.mjs';

function withGitHubEnv(run) {
  const previousToken = process.env.GITHUB_AGENT_TOKEN;
  const previousRepos = process.env.GITHUB_ALLOWED_REPOS;
  process.env.GITHUB_AGENT_TOKEN = 'test-github-agent-token';
  process.env.GITHUB_ALLOWED_REPOS = 'owner/repo';
  try {
    return run();
  } finally {
    if (previousToken === undefined) delete process.env.GITHUB_AGENT_TOKEN;
    else process.env.GITHUB_AGENT_TOKEN = previousToken;
    if (previousRepos === undefined) delete process.env.GITHUB_ALLOWED_REPOS;
    else process.env.GITHUB_ALLOWED_REPOS = previousRepos;
  }
}

function snapshot() {
  return {
    repo: 'owner/repo',
    baseBranch: 'main',
    baseSha: 'abc123',
    baseTreeSha: 'tree123',
    files: { 'src/a.ts': 'export const value = 1;\n' },
    metadata: { 'src/a.ts': { sha: 'blob123', mode: '100644' } },
    existingPaths: new Set(['src/a.ts']),
  };
}

test('review-stage token is signed and tamper evident', () => withGitHubEnv(() => {
  const stage = {
    files: { 'src/a.ts': 'export const value = 2;\n' },
    operations: [{ path: 'src/a.ts', operation: 'update' }],
    dev: { summary: 'Changed value.', turns: 1, usage: null },
  };
  const token = createReviewStageToken(snapshot(), 'Update src/a.ts', stage);
  const verified = verifyReviewStageToken(token);
  assert.equal(verified.repo, 'owner/repo');
  assert.equal(verified.baseSha, 'abc123');
  assert.equal(verified.changes.length, 1);
  assert.equal(verified.changes[0].content, 'export const value = 2;\n');

  const last = token.at(-1);
  const tampered = `${token.slice(0, -1)}${last === 'a' ? 'b' : 'a'}`;
  assert.throws(() => verifyReviewStageToken(tampered), /signature|invalid/i);
}));

test('review-stage token refuses protected and unseen existing paths', () => withGitHubEnv(() => {
  assert.throws(() => createReviewStageToken(snapshot(), 'bad', {
    files: { '.github/workflows/ci.yml': 'bad' },
    operations: [{ path: '.github/workflows/ci.yml', operation: 'create' }],
    dev: { summary: 'bad' },
  }), /protected/i);

  const snap = snapshot();
  snap.existingPaths.add('src/unseen.ts');
  assert.throws(() => createReviewStageToken(snap, 'bad', {
    files: { ...snap.files, 'src/unseen.ts': 'replacement' },
    operations: [{ path: 'src/unseen.ts', operation: 'update' }],
    dev: { summary: 'bad' },
  }), /unseen existing/i);
}));

test('signed changes reconstruct the reviewed workspace deterministically', () => {
  const workspace = new VirtualWorkspace({ 'src/a.ts': 'old\n' });
  applySignedChanges(workspace, [{ path: 'src/a.ts', content: 'new\n' }]);
  assert.equal(workspace.readFile('src/a.ts'), 'new\n');
  assert.match(workspace.diff(), /new/);
});

test('native GitHub reviewer endpoint is operator-protected', () => {
  assert.equal(commonInternals.isGitHubAction({ path: '/.netlify/functions/github-review' }), true);
});

test('OpenAI stage timeout stays below observed 30 second serverless limit', () => {
  assert.ok(openaiProviderInternals.requestTimeoutMs > 0);
  assert.ok(openaiProviderInternals.requestTimeoutMs < 30_000);
});
