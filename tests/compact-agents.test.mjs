import test from 'node:test';
import assert from 'node:assert/strict';
import { compactInternals } from '../src/compact-agents.mjs';
import { VirtualWorkspace } from '../src/workspace.mjs';

test('compact agent applies bounded file changes through VirtualWorkspace', () => {
  const workspace = new VirtualWorkspace({ 'src/App.tsx': 'old' });
  const applied = compactInternals.applyCompactChanges(workspace, [
    { path: 'src/App.tsx', content: 'new' },
    { path: 'src/styles.css', content: 'body{}' },
  ]);
  assert.equal(applied.length, 2);
  assert.equal(workspace.readFile('src/App.tsx'), 'new');
  assert.equal(workspace.readFile('src/styles.css'), 'body{}');
});

test('compact agent cannot escape the virtual workspace', () => {
  const workspace = new VirtualWorkspace({ 'src/App.tsx': 'safe' });
  assert.throws(
    () => compactInternals.applyCompactChanges(workspace, [{ path: '../secret.txt', content: 'nope' }]),
    /not allowed|Invalid|path/i,
  );
});

test('compact reviewer cannot approve high or critical findings', () => {
  const review = compactInternals.normalizeReview({
    verdict: 'approve',
    score: 95,
    summary: 'Looks good',
    findings: [{ severity: 'high', title: 'Broken mobile layout', detail: '320px overflows.' }],
  });
  assert.equal(review.verdict, 'changes_requested');
  assert.equal(review.findings.length, 1);
});
