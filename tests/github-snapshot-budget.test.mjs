import test from 'node:test';
import assert from 'node:assert/strict';
import { githubInternals, selectSnapshotEntries } from '../src/github-runtime.mjs';

const entries = [
  { type: 'blob', path: 'packages/domain/src/access-control.ts', sha: '1', size: 3000 },
  { type: 'blob', path: 'packages/domain/src/access-control.test.ts', sha: '2', size: 1800 },
  { type: 'blob', path: 'AGENTS.md', sha: '3', size: 2500 },
  { type: 'blob', path: 'package.json', sha: '4', size: 900 },
  { type: 'blob', path: 'packages/domain/src/audit.ts', sha: '5', size: 2200 },
  { type: 'blob', path: 'packages/application/src/people-service.ts', sha: '6', size: 5000 },
  { type: 'blob', path: 'README.md', sha: '7', size: 4500 },
];

test('explicit file tasks keep both named files and only one support file', () => {
  const task = 'Trabalhe exclusivamente em packages/domain/src/access-control.ts e packages/domain/src/access-control.test.ts. Faça hardening de createAccessContext.';
  const ranked = selectSnapshotEntries(entries, task);
  const selected = githubInternals.selectSnapshotCandidates(ranked);

  assert.deepEqual(
    selected.filter(item => item.explicit).map(item => item.path).sort(),
    ['packages/domain/src/access-control.test.ts', 'packages/domain/src/access-control.ts'],
  );
  assert.equal(selected.length, 3);
  assert.equal(selected.filter(item => !item.explicit).length, 1);
  assert.ok(selected.some(item => item.path === 'AGENTS.md'));
});

test('tasks without explicit paths preserve normal ranked snapshot behavior', () => {
  const ranked = selectSnapshotEntries(entries, 'Melhore a segurança do domínio sem alterar a interface pública.');
  const selected = githubInternals.selectSnapshotCandidates(ranked);
  assert.equal(selected.length, ranked.length);
});
