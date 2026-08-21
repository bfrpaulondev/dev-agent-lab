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

test('dev envelope accepts raw TSX, CSS and JSON-like content without JSON escaping', () => {
  const envelope = `SUMMARY:\nImproved the dashboard.\n<<<FILE path="src/App.tsx">>>\nexport default function App() {\n  const config = { label: "Ready", count: 2 };\n  return <main aria-label={config.label}>Hello</main>;\n}\n<<<END FILE>>>\n<<<FILE path="src/styles.css">>>\n.page { width: min(100% - 2rem, 72rem); }\n@media (max-width: 320px) { .page { width: 100%; } }\n<<<END FILE>>>`;
  const parsed = compactInternals.parseDevEnvelope(envelope);
  assert.equal(parsed.summary, 'Improved the dashboard.');
  assert.equal(parsed.changes.length, 2);
  assert.match(parsed.changes[0].content, /aria-label/);
  assert.match(parsed.changes[1].content, /320px/);
});

test('dev envelope supports explicit deletions and rejects unstructured prose', () => {
  const parsed = compactInternals.parseDevEnvelope('SUMMARY:\nRemove obsolete file.\n<<<DELETE path="src/old.ts">>>');
  assert.deepEqual(parsed.changes, [{ path: 'src/old.ts', delete: true }]);
  assert.throws(() => compactInternals.parseDevEnvelope('I changed some files.'), /invalid file envelope/i);
});

test('review envelope parses findings and normalization enforces blocking severity', () => {
  const parsed = compactInternals.parseReviewEnvelope(`VERDICT: approve\nSCORE: 91\nSUMMARY:\nGood direction, but one blocker remains.\n<<<FINDING>>>\nSEVERITY: high\nFILE: src/styles.css\nTITLE: Mobile overflow\nDETAIL:\nThe fixed width still exceeds 320px.\n<<<END FINDING>>>`);
  const review = compactInternals.normalizeReview(parsed);
  assert.equal(review.score, 91);
  assert.equal(review.verdict, 'changes_requested');
  assert.equal(review.findings[0].file, 'src/styles.css');
});

test('compact requests disable Qwen reasoning and keep GPT-OSS reviewer reasoning low', () => {
  assert.equal(compactInternals.modelReasoningEffort('qwen/qwen3.6-27b'), 'none');
  assert.equal(compactInternals.modelReasoningEffort('openai/gpt-oss-120b'), 'low');
});
