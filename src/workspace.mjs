import path from 'node:path';

const MAX_FILES = 80;
const MAX_FILE_BYTES = 80_000;
const MAX_WORKSPACE_BYTES = 600_000;
const BLOCKED_MARKERS = [/BEGIN [A-Z ]*PRIVATE KEY/i, /gh[pousr]_[A-Za-z0-9_]{20,}/, /gsk_[A-Za-z0-9]{20,}/];

function assertPath(input) {
  if (typeof input !== 'string' || input.length < 1 || input.length > 180) throw new Error('Invalid path');
  if (input.includes('\\')) throw new Error('Use POSIX paths only');
  const normalized = path.posix.normalize(input);
  if (normalized === '.' || normalized.startsWith('../') || normalized.startsWith('/') || normalized.includes('/../')) {
    throw new Error('Path escapes virtual workspace');
  }
  if (normalized.startsWith('.git/') || normalized === '.git') throw new Error('Git internals are not writable');
  return normalized;
}

function assertContent(content) {
  if (typeof content !== 'string') throw new Error('Content must be text');
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new Error('File exceeds size limit');
  for (const marker of BLOCKED_MARKERS) {
    if (marker.test(content)) throw new Error('Potential secret material rejected');
  }
}

function totalBytes(files) {
  return Object.entries(files).reduce((sum, [name, content]) => sum + Buffer.byteLength(name + content, 'utf8'), 0);
}

function cloneFiles(files) {
  return Object.fromEntries(Object.entries(files).map(([name, content]) => [name, String(content)]));
}

export class VirtualWorkspace {
  constructor(seed) {
    if (!seed || typeof seed !== 'object' || Array.isArray(seed)) throw new Error('Invalid workspace seed');
    const validated = {};
    for (const [filePath, content] of Object.entries(seed)) {
      const safe = assertPath(filePath);
      assertContent(content);
      validated[safe] = content;
    }
    if (Object.keys(validated).length > MAX_FILES) throw new Error('Workspace file limit reached');
    if (totalBytes(validated) > MAX_WORKSPACE_BYTES) throw new Error('Workspace size limit reached');
    this.original = cloneFiles(validated);
    this.files = cloneFiles(validated);
    this.operations = [];
  }

  listFiles() {
    return Object.keys(this.files).sort();
  }

  readFile(filePath) {
    const safe = assertPath(filePath);
    if (!(safe in this.files)) throw new Error(`File not found: ${safe}`);
    return this.files[safe];
  }

  writeFile(filePath, content) {
    const safe = assertPath(filePath);
    assertContent(content);
    const isNew = !(safe in this.files);
    if (isNew && Object.keys(this.files).length >= MAX_FILES) throw new Error('Workspace file limit reached');
    const next = { ...this.files, [safe]: content };
    if (totalBytes(next) > MAX_WORKSPACE_BYTES) throw new Error('Workspace size limit reached');
    this.files = next;
    this.operations.push({ op: isNew ? 'create' : 'update', path: safe });
    return { path: safe, bytes: Buffer.byteLength(content, 'utf8'), operation: isNew ? 'created' : 'updated' };
  }

  deleteFile(filePath) {
    const safe = assertPath(filePath);
    if (!(safe in this.files)) throw new Error(`File not found: ${safe}`);
    const next = { ...this.files };
    delete next[safe];
    this.files = next;
    this.operations.push({ op: 'delete', path: safe });
    return { path: safe, operation: 'deleted' };
  }

  search(query) {
    if (typeof query !== 'string' || !query.trim() || query.length > 120) throw new Error('Invalid search query');
    const needle = query.toLowerCase();
    const matches = [];
    for (const [file, content] of Object.entries(this.files)) {
      const lines = content.split(/\r?\n/);
      lines.forEach((line, index) => {
        if (line.toLowerCase().includes(needle) && matches.length < 60) {
          matches.push({ file, line: index + 1, text: line.slice(0, 240) });
        }
      });
    }
    return matches;
  }

  qualityReport() {
    const findings = [];
    for (const [file, content] of Object.entries(this.files)) {
      if (/\bTODO\b|\bFIXME\b|placeholder/i.test(content)) findings.push({ severity: 'warning', file, message: 'Placeholder/TODO marker present' });
      if (/console\.log\s*\(/.test(content)) findings.push({ severity: 'warning', file, message: 'console.log present' });
      if (/onClick=\{?\s*\(\)\s*=>\s*\{?\s*\}?\s*\}?/.test(content)) findings.push({ severity: 'warning', file, message: 'Potential inert click handler' });
      if (file.endsWith('.css') && /width:\s*9\d\dpx/.test(content)) findings.push({ severity: 'warning', file, message: 'Large fixed pixel width may break mobile layouts' });
      if (file.endsWith('.tsx') && /<button(?![^>]*aria-label)/.test(content) && /<button[^>]*>\s*[<]/.test(content)) findings.push({ severity: 'info', file, message: 'Icon-only button may need accessible name' });
    }
    return {
      ok: !findings.some(item => item.severity === 'error'),
      fileCount: Object.keys(this.files).length,
      workspaceBytes: totalBytes(this.files),
      findings,
    };
  }

  diff() {
    const paths = new Set([...Object.keys(this.original), ...Object.keys(this.files)]);
    const chunks = [];
    for (const file of [...paths].sort()) {
      const before = this.original[file];
      const after = this.files[file];
      if (before === after) continue;
      chunks.push(renderSimpleDiff(file, before, after));
    }
    return chunks.join('\n');
  }

  snapshot() {
    return cloneFiles(this.files);
  }
}

function renderSimpleDiff(file, before, after) {
  const head = `diff --virtual a/${file} b/${file}`;
  if (before === undefined) return `${head}\n--- /dev/null\n+++ b/${file}\n${after.split(/\r?\n/).map(line => `+${line}`).join('\n')}`;
  if (after === undefined) return `${head}\n--- a/${file}\n+++ /dev/null\n${before.split(/\r?\n/).map(line => `-${line}`).join('\n')}`;
  const oldLines = before.split(/\r?\n/);
  const newLines = after.split(/\r?\n/);
  const prefix = [];
  const suffix = [];
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (oldEnd >= start && newEnd >= start && oldLines[oldEnd] === newLines[newEnd]) {
    suffix.unshift(` ${oldLines[oldEnd]}`);
    oldEnd--; newEnd--;
  }
  const contextStart = Math.max(0, start - 3);
  for (let i = contextStart; i < start; i++) prefix.push(` ${oldLines[i]}`);
  const removed = oldLines.slice(start, oldEnd + 1).map(line => `-${line}`);
  const added = newLines.slice(start, newEnd + 1).map(line => `+${line}`);
  const tail = suffix.slice(0, 3);
  return `${head}\n--- a/${file}\n+++ b/${file}\n@@ -${start + 1},${Math.max(0, oldEnd - start + 1)} +${start + 1},${Math.max(0, newEnd - start + 1)} @@\n${[...prefix, ...removed, ...added, ...tail].join('\n')}`;
}

export const workspaceInternals = { assertPath, assertContent };
