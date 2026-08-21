import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertAllowedRepo,
  createProposalToken,
  enforceGitHubWritePolicy,
  isProtectedWritePath,
  selectSnapshotEntries,
  verifyProposalToken,
  githubInternals,
} from '../src/github-runtime.mjs';

function withGitHubEnv(fn) {
  const oldToken = process.env.GITHUB_AGENT_TOKEN;
  const oldRepos = process.env.GITHUB_ALLOWED_REPOS;
  process.env.GITHUB_AGENT_TOKEN = 'test-token-not-a-real-secret';
  process.env.GITHUB_ALLOWED_REPOS = 'owner/repo,owner/second';
  try {
    return fn();
  } finally {
    if (oldToken === undefined) delete process.env.GITHUB_AGENT_TOKEN;
    else process.env.GITHUB_AGENT_TOKEN = oldToken;
    if (oldRepos === undefined) delete process.env.GITHUB_ALLOWED_REPOS;
    else process.env.GITHUB_ALLOWED_REPOS = oldRepos;
  }
}

test('GitHub mode only accepts explicitly allowlisted repositories', () => withGitHubEnv(() => {
  assert.equal(assertAllowedRepo('owner/repo'), 'owner/repo');
  assert.throws(() => assertAllowedRepo('owner/not-allowed'), /allowlisted/i);
  assert.throws(() => assertAllowedRepo('../bad'), /invalid/i);
}));

test('GitHub write policy blocks workflows, infra, agent policy and secrets', () => {
  for (const file of [
    'AGENTS.md',
    '.github/workflows/ci.yml',
    '.env.production',
    'infra/main.tf',
    'netlify.toml',
    'keys/server.pem',
    'node_modules/pkg/index.js',
    'dist/app.js',
  ]) assert.equal(isProtectedWritePath(file), true, file);
  assert.equal(isProtectedWritePath('src/App.tsx'), false);
});

test('snapshot selector prioritizes task-relevant UI entrypoints', () => {
  const entries = [
    { type: 'blob', path: 'src/random.ts', sha: '1', size: 10 },
    { type: 'blob', path: 'public/styles.css', sha: '2', size: 10 },
    { type: 'blob', path: 'public/index.html', sha: '3', size: 10 },
    { type: 'blob', path: 'README.md', sha: '4', size: 10 },
  ];
  const selected = selectSnapshotEntries(entries, 'Melhore a UI e responsividade do dashboard');
  assert.ok(['public/index.html', 'public/styles.css'].includes(selected[0].path));
  assert.ok(selected.findIndex(item => item.path === 'public/index.html') < selected.findIndex(item => item.path === 'src/random.ts'));
  assert.ok(selected.findIndex(item => item.path === 'public/styles.css') < selected.findIndex(item => item.path === 'src/random.ts'));
});

test('approved proposal token is signed and tamper-evident', () => withGitHubEnv(() => {
  const snapshot = {
    repo: 'owner/repo',
    baseBranch: 'main',
    baseSha: 'abc123',
    baseTreeSha: 'tree123',
    files: { 'src/App.tsx': 'before' },
    metadata: { 'src/App.tsx': { sha: 'blob1', mode: '100644' } },
    existingPaths: new Set(['src/App.tsx']),
  };
  const result = {
    status: 'approved',
    files: { 'src/App.tsx': 'after' },
    operations: [{ path: 'src/App.tsx' }],
    history: [{ review: { score: 91, summary: 'Approved', verdict: 'approve', findings: [] } }],
  };
  const token = createProposalToken(snapshot, 'Update the UI', result);
  const proposal = verifyProposalToken(token);
  assert.equal(proposal.repo, 'owner/repo');
  assert.equal(proposal.changes[0].content, 'after');
  const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
  assert.throws(() => verifyProposalToken(tampered), /signature|invalid/i);
}));

test('protected changes can never remain approved even if reviewer approved them', () => {
  const result = {
    status: 'approved',
    operations: [{ path: '.github/workflows/pwn.yml' }],
    history: [{ review: { verdict: 'approve', score: 100, summary: 'Looks good', findings: [] } }],
  };
  enforceGitHubWritePolicy(result);
  assert.equal(result.status, 'changes_requested');
  assert.equal(result.history[0].review.verdict, 'changes_requested');
  assert.equal(result.history[0].review.findings.at(-1).severity, 'high');
});

test('write gate blocks replacing an existing repository file that was not in the reviewed snapshot', () => {
  const result = {
    status: 'approved',
    files: { 'src/hidden.ts': 'replacement' },
    operations: [{ path: 'src/hidden.ts' }],
    history: [{ review: { verdict: 'approve', score: 100, summary: 'Looks good', findings: [] } }],
  };
  const snapshot = {
    files: { 'src/App.tsx': 'visible' },
    existingPaths: new Set(['src/App.tsx', 'src/hidden.ts']),
  };
  enforceGitHubWritePolicy(result, snapshot);
  assert.equal(result.status, 'changes_requested');
  assert.match(result.history[0].review.findings.at(-1).title, /unseen existing/i);
});

test('proposal branch name is deterministic so replay cannot create a second branch', () => {
  const one = githubInternals.branchSlug('Fix login UI', 'same-proposal-token');
  const two = githubInternals.branchSlug('Fix login UI', 'same-proposal-token');
  const other = githubInternals.branchSlug('Fix login UI', 'different-proposal-token');
  assert.equal(one, two);
  assert.notEqual(one, other);
  assert.match(one, /^agent\//);
});
