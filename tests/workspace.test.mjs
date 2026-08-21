import test from 'node:test';
import assert from 'node:assert/strict';
import { VirtualWorkspace, workspaceInternals } from '../src/workspace.mjs';

const seed = { 'src/a.ts': 'export const a = 1;\n', 'README.md': '# Test\n' };

test('virtual workspace reads, writes and renders a diff', () => {
  const workspace = new VirtualWorkspace(seed);
  workspace.writeFile('src/a.ts', 'export const a = 2;\n');
  workspace.writeFile('src/b.ts', 'export const b = 3;\n');
  assert.equal(workspace.readFile('src/a.ts'), 'export const a = 2;\n');
  assert.match(workspace.diff(), /src\/a\.ts/);
  assert.match(workspace.diff(), /src\/b\.ts/);
});

test('path traversal and git internals are rejected', () => {
  for (const value of ['../secret', '/etc/passwd', '.git/config', 'src/../../secret']) {
    assert.throws(() => workspaceInternals.assertPath(value));
  }
});

test('potential secret material is rejected', () => {
  assert.throws(() => workspaceInternals.assertContent('GROQ=gsk_abcdefghijklmnopqrstuvwxyz123456789'));
  assert.throws(() => workspaceInternals.assertContent('-----BEGIN PRIVATE KEY-----'));
});

test('constructor validates untrusted seed paths', () => {
  assert.throws(() => new VirtualWorkspace({ '../outside': 'nope' }));
});

test('error and empty quality checks stay deterministic', () => {
  const workspace = new VirtualWorkspace({ 'src/App.tsx': '// TODO placeholder\nconsole.log("x")\n' });
  const report = workspace.qualityReport();
  assert.equal(report.findings.length, 2);
  assert.equal(report.ok, true);
});
