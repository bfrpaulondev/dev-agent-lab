import test from 'node:test';
import assert from 'node:assert/strict';
import { selectSnapshotEntries } from '../src/github-runtime.mjs';
import { githubReviewInternals } from '../netlify/functions/github-review.mjs';

test('explicitly named existing file wins snapshot selection priority', () => {
  const entries = [
    { type: 'blob', path: 'public/index.html', sha: '1', size: 100 },
    { type: 'blob', path: 'public/app.js', sha: '2', size: 100 },
    { type: 'blob', path: 'public/styles.css', sha: '3', size: 100 },
    { type: 'blob', path: 'AGENTS.md', sha: '4', size: 100 },
    { type: 'blob', path: 'package.json', sha: '5', size: 100 },
    { type: 'blob', path: 'src/agents.mjs', sha: '6', size: 100 },
    { type: 'blob', path: 'src/workspace.mjs', sha: '7', size: 100 },
    { type: 'blob', path: 'README.md', sha: '8', size: 100 },
  ];

  const ranked = selectSnapshotEntries(
    entries,
    'No README.md, adicione uma seção curta chamada First controlled GitHub test.',
  );

  assert.equal(ranked[0].path, 'README.md');
  assert.ok(ranked.slice(0, 7).some(item => item.path === 'README.md'));
});

test('GitHub result suppresses deterministic findings that already existed in the snapshot', () => {
  const baselineFinding = {
    severity: 'warning',
    file: 'public/index.html',
    message: 'Placeholder/TODO marker present',
  };
  const newFinding = {
    severity: 'warning',
    file: 'README.md',
    message: 'New deterministic issue',
  };
  const result = {
    quality: {
      ok: true,
      findings: [baselineFinding, newFinding],
    },
  };

  githubReviewInternals.filterBaselineQuality(result, { findings: [baselineFinding] });

  assert.deepEqual(result.quality.findings, [newFinding]);
  assert.equal(result.quality.baselineFindingsSuppressed, 1);
});
