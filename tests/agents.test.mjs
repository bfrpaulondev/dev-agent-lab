import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { agentInternals } from '../src/agents.mjs';
import { VirtualWorkspace } from '../src/workspace.mjs';

test('review normalization never approves critical/high findings', () => {
  const review = agentInternals.normalizeReview({
    verdict: 'approve', score: 92, summary: 'Looks good',
    findings: [{ severity: 'high', title: 'Broken auth', detail: 'Material issue' }],
  });
  assert.equal(review.verdict, 'changes_requested');
});

test('review normalization clamps score and finding count', () => {
  const review = agentInternals.normalizeReview({ verdict: 'approve', score: 500, findings: [] });
  assert.equal(review.score, 100);
  assert.equal(review.verdict, 'approve');
});

test('tool executor exposes allowlisted workspace operations only', () => {
  const workspace = new VirtualWorkspace({ 'a.txt': 'hello' });
  assert.deepEqual(agentInternals.executeTool(workspace, 'list_files', {}), ['a.txt']);
  assert.throws(() => agentInternals.executeTool(workspace, 'shell', { command: 'rm -rf /' }), /not allowed/);
});

test('tool arguments reject malformed JSON', () => {
  assert.throws(() => agentInternals.parseToolArguments({ function: { name: 'read_file', arguments: '{oops' } }));
});

test('prompt root resolution is compatible with Netlify bundled functions', () => {
  const previous = process.env.LAMBDA_TASK_ROOT;
  process.env.LAMBDA_TASK_ROOT = '/var/task';
  try {
    assert.equal(agentInternals.promptRootDir(), path.resolve('/var/task'));
  } finally {
    if (previous === undefined) delete process.env.LAMBDA_TASK_ROOT;
    else process.env.LAMBDA_TASK_ROOT = previous;
  }
});
