import crypto from 'node:crypto';

const API_ROOT = 'https://api.github.com';
const MAX_SNAPSHOT_FILES = 7;
const MAX_SNAPSHOT_BYTES = 18_000;
const MAX_FILE_BYTES = 12_000;
const PROPOSAL_TTL_MS = 15 * 60 * 1000;

const TEXT_EXTENSIONS = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.css', '.scss', '.html', '.md',
  '.json', '.yml', '.yaml', '.toml', '.txt', '.py', '.go', '.rs', '.java', '.kt',
  '.sql', '.sh', '.vue', '.svelte',
]);

const ALWAYS_READ = new Set([
  'AGENTS.md', 'README.md', 'package.json', 'pyproject.toml', 'requirements.txt',
  'vite.config.js', 'vite.config.ts', 'next.config.js', 'next.config.mjs',
]);

const PROTECTED_EXACT = new Set([
  'AGENTS.md',
  'netlify.toml',
  'vercel.json',
  'Dockerfile',
  'docker-compose.yml',
  'docker-compose.yaml',
]);

const SENSITIVE_BASENAMES = new Set([
  '.env', '.npmrc', '.netrc', 'id_rsa', 'id_ed25519', 'credentials', 'credentials.json',
]);

function normalizeRepo(value) {
  const repo = String(value || '').trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error('Invalid GitHub repository.');
  const [owner, name] = repo.split('/');
  if (!owner || !name || owner === '.' || owner === '..' || name === '.' || name === '..') throw new Error('Invalid GitHub repository.');
  return repo;
}

export function githubToken() {
  return process.env.GITHUB_AGENT_TOKEN || '';
}

export function allowedRepos() {
  return String(process.env.GITHUB_ALLOWED_REPOS || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(normalizeRepo);
}

export function githubConfigured() {
  return Boolean(githubToken() && allowedRepos().length);
}

export function assertAllowedRepo(input) {
  const repo = normalizeRepo(input);
  if (!allowedRepos().includes(repo)) throw Object.assign(new Error('Repository is not allowlisted.'), { statusCode: 403 });
  return repo;
}

function fileExt(filePath) {
  const base = filePath.split('/').pop() || '';
  const index = base.lastIndexOf('.');
  return index >= 0 ? base.slice(index).toLowerCase() : '';
}

function isSensitivePath(filePath) {
  const normalized = String(filePath || '').replace(/^\/+/, '');
  const base = normalized.split('/').pop() || '';
  if (SENSITIVE_BASENAMES.has(base)) return true;
  if (/^\.env(?:\.|$)/i.test(base)) return true;
  if (/\.(?:pem|key|p12|pfx|crt)$/i.test(base)) return true;
  if (/(?:^|\/)(?:secrets?|credentials?)(?:\/|\.|$)/i.test(normalized)) return true;
  return false;
}

export function isProtectedWritePath(filePath) {
  const normalized = String(filePath || '').replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || normalized.includes('\\')) return true;
  if (PROTECTED_EXACT.has(normalized)) return true;
  if (normalized === '.github' || normalized.startsWith('.github/')) return true;
  if (normalized.startsWith('.git/')) return true;
  if (normalized.startsWith('infra/') || normalized.startsWith('terraform/')) return true;
  if (normalized.startsWith('node_modules/') || normalized.startsWith('dist/') || normalized.startsWith('build/') || normalized.startsWith('.next/') || normalized.startsWith('coverage/')) return true;
  if (/\.tf(?:vars)?$/i.test(normalized)) return true;
  if (isSensitivePath(normalized)) return true;
  return false;
}

function isCandidateBlob(entry) {
  if (!entry || entry.type !== 'blob' || typeof entry.path !== 'string') return false;
  if (entry.size && entry.size > MAX_FILE_BYTES) return false;
  if (isSensitivePath(entry.path)) return false;
  const ext = fileExt(entry.path);
  return ALWAYS_READ.has(entry.path) || TEXT_EXTENSIONS.has(ext);
}

function taskTokens(task) {
  return [...new Set(
    String(task || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(token => token.length >= 3)
      .slice(0, 40)
  )];
}

function scorePath(filePath, task) {
  const pathLower = filePath.toLowerCase();
  const taskPathText = String(task || '').replace(/\\/g, '/').toLowerCase();
  const basename = pathLower.split('/').pop() || '';
  let score = 0;
  if (taskPathText.includes(pathLower) || (basename.length >= 4 && taskPathText.includes(basename))) score += 5_000;
  if (ALWAYS_READ.has(filePath)) score += filePath === 'AGENTS.md' ? 1200 : filePath === 'package.json' ? 700 : 450;
  if (/^(src|app|pages|public|lib|server|api)\//.test(pathLower)) score += 80;
  if (/(app|main|index|server|route|controller|service|styles?)\.[a-z0-9]+$/.test(pathLower)) score += 110;

  for (const token of taskTokens(task)) {
    if (pathLower.includes(token)) score += 120;
  }

  const normalizedTask = String(task || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/(ui|ux|visual|interface|dashboard|layout|css|responsiv|acessib|frontend)/.test(normalizedTask)) {
    if (/public\/(index\.html|app\.js|styles\.css)$/.test(pathLower)) score += 600;
    if (/src\/(app|main|index)\.(tsx|jsx|ts|js)$/.test(pathLower)) score += 560;
    if (/\.(css|scss)$/.test(pathLower)) score += 280;
    if (/components?\//.test(pathLower)) score += 180;
  }
  if (/(api|backend|endpoint|route|server|auth|database|banco|sql)/.test(normalizedTask)) {
    if (/(server|api|routes?|controllers?|services?|db|database)/.test(pathLower)) score += 420;
  }
  if (/(test|teste|spec|bug|fix|erro)/.test(normalizedTask) && /\.(test|spec)\./.test(pathLower)) score += 360;
  return score;
}

export function selectSnapshotEntries(treeEntries, task) {
  return (Array.isArray(treeEntries) ? treeEntries : [])
    .filter(isCandidateBlob)
    .map(entry => ({ ...entry, score: scorePath(entry.path, task) }))
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

async function githubRequest(endpoint, options = {}) {
  const token = githubToken();
  if (!token) throw Object.assign(new Error('GITHUB_AGENT_TOKEN is not configured on the server.'), { statusCode: 503 });
  const response = await fetch(`${API_ROOT}${endpoint}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'ForgePair-Controlled-Agent',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });
  const raw = await response.text();
  let payload = null;
  try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
  if (!response.ok) {
    const error = new Error(response.status === 401 || response.status === 403
      ? 'GitHub rejected the configured agent credentials or permissions.'
      : response.status === 404
        ? 'GitHub repository resource was not found.'
        : `GitHub request failed (${response.status}).`);
    error.statusCode = response.status;
    error.githubStatus = response.status;
    throw error;
  }
  return payload;
}

function decodeBlob(blob) {
  if (!blob || blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new Error('Unsupported GitHub blob encoding.');
  return Buffer.from(blob.content.replace(/\n/g, ''), 'base64').toString('utf8');
}

export async function loadRepositorySnapshot(repoInput, task) {
  const repo = assertAllowedRepo(repoInput);
  const meta = await githubRequest(`/repos/${repo}`);
  const baseBranch = meta?.default_branch || 'main';
  const ref = await githubRequest(`/repos/${repo}/git/ref/heads/${encodeURIComponent(baseBranch)}`);
  const baseSha = ref?.object?.sha;
  if (!baseSha) throw new Error('Could not resolve the repository default branch.');
  const commit = await githubRequest(`/repos/${repo}/git/commits/${baseSha}`);
  const baseTreeSha = commit?.tree?.sha;
  if (!baseTreeSha) throw new Error('Could not resolve the repository tree.');
  const tree = await githubRequest(`/repos/${repo}/git/trees/${baseTreeSha}?recursive=1`);

  const existingPaths = new Set((tree?.tree || []).map(entry => entry.path).filter(Boolean));
  const ranked = selectSnapshotEntries(tree?.tree, task);
  const files = {};
  const metadata = {};
  let total = 0;

  for (const entry of ranked) {
    if (Object.keys(files).length >= MAX_SNAPSHOT_FILES) break;
    if (entry.size && total + entry.size > MAX_SNAPSHOT_BYTES && Object.keys(files).length >= 2) continue;
    const blob = await githubRequest(`/repos/${repo}/git/blobs/${entry.sha}`);
    const content = decodeBlob(blob);
    const bytes = Buffer.byteLength(content, 'utf8');
    if (bytes > MAX_FILE_BYTES) continue;
    if (total + bytes > MAX_SNAPSHOT_BYTES && Object.keys(files).length >= 2) continue;
    files[entry.path] = content;
    metadata[entry.path] = { sha: entry.sha, mode: entry.mode || '100644' };
    total += bytes;
  }

  if (!Object.keys(files).length) throw Object.assign(new Error('No safe text files could be loaded from the repository.'), { statusCode: 422 });
  return { repo, baseBranch, baseSha, baseTreeSha, files, metadata, existingPaths, snapshotBytes: total };
}

function ensureHighFinding(result, finding) {
  const last = result?.history?.at?.(-1);
  if (!last?.review) return;
  last.review.verdict = 'changes_requested';
  last.review.score = Math.min(Number(last.review.score || 0), 60);
  last.review.findings = [...(last.review.findings || []), finding];
  result.status = 'changes_requested';
}

export function enforceGitHubWritePolicy(result, snapshot = null) {
  const paths = [...new Set((result?.operations || []).map(item => item.path).filter(Boolean))];
  const blocked = paths.filter(isProtectedWritePath);
  if (blocked.length) {
    ensureHighFinding(result, {
      severity: 'high',
      title: 'Protected GitHub path',
      detail: `Controlled GitHub mode cannot modify protected paths: ${blocked.join(', ')}`,
      file: blocked[0],
    });
  }

  const unseenExisting = snapshot?.existingPaths
    ? paths.filter(filePath =>
        !Object.prototype.hasOwnProperty.call(snapshot.files || {}, filePath) &&
        snapshot.existingPaths.has(filePath))
    : [];
  if (unseenExisting.length) {
    ensureHighFinding(result, {
      severity: 'high',
      title: 'Unseen existing file',
      detail: `The agent attempted to replace repository files that were not present in its reviewed snapshot: ${unseenExisting.join(', ')}`,
      file: unseenExisting[0],
    });
  }
  return result;
}

function changedFilesForProposal(snapshot, result) {
  const changed = [];
  const paths = [...new Set((result?.operations || []).map(item => item.path).filter(Boolean))];
  for (const filePath of paths) {
    if (isProtectedWritePath(filePath)) throw new Error(`Protected GitHub path: ${filePath}`);
    const beforeExists = Object.prototype.hasOwnProperty.call(snapshot.files, filePath);
    if (!beforeExists && snapshot.existingPaths?.has(filePath)) throw new Error(`Cannot replace unseen existing GitHub file: ${filePath}`);
    const afterExists = Object.prototype.hasOwnProperty.call(result.files || {}, filePath);
    if (beforeExists && afterExists && snapshot.files[filePath] === result.files[filePath]) continue;
    if (!afterExists) {
      changed.push({ path: filePath, delete: true, mode: snapshot.metadata[filePath]?.mode || '100644' });
      continue;
    }
    changed.push({
      path: filePath,
      content: result.files[filePath],
      mode: snapshot.metadata[filePath]?.mode || '100644',
    });
  }
  return changed;
}

function signingKey() {
  const token = githubToken();
  if (!token) throw new Error('GitHub signing key unavailable.');
  return crypto.createHash('sha256').update(`forgepair-proposal-v1:${token}`).digest();
}

export function createProposalToken(snapshot, task, result) {
  if (result?.status !== 'approved') return null;
  const changes = changedFilesForProposal(snapshot, result);
  if (!changes.length) return null;
  const review = result.history?.at?.(-1)?.review || null;
  const proposal = {
    version: 1,
    repo: snapshot.repo,
    baseBranch: snapshot.baseBranch,
    baseSha: snapshot.baseSha,
    baseTreeSha: snapshot.baseTreeSha,
    task: String(task || '').trim().slice(0, 6000),
    createdAt: Date.now(),
    expiresAt: Date.now() + PROPOSAL_TTL_MS,
    changes,
    review: review ? { score: review.score, summary: review.summary } : null,
  };
  const encoded = Buffer.from(JSON.stringify(proposal), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', signingKey()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyProposalToken(token) {
  const [encoded, signature, extra] = String(token || '').split('.');
  if (!encoded || !signature || extra) throw Object.assign(new Error('Invalid GitHub proposal token.'), { statusCode: 400 });
  const expected = crypto.createHmac('sha256', signingKey()).update(encoded).digest();
  let received;
  try { received = Buffer.from(signature, 'base64url'); } catch { throw Object.assign(new Error('Invalid GitHub proposal token.'), { statusCode: 400 }); }
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    throw Object.assign(new Error('GitHub proposal signature is invalid.'), { statusCode: 403 });
  }
  let proposal;
  try { proposal = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')); } catch { throw Object.assign(new Error('Invalid GitHub proposal payload.'), { statusCode: 400 }); }
  if (proposal.version !== 1 || Date.now() > Number(proposal.expiresAt || 0)) throw Object.assign(new Error('GitHub proposal expired or is unsupported.'), { statusCode: 409 });
  proposal.repo = assertAllowedRepo(proposal.repo);
  if (!Array.isArray(proposal.changes) || !proposal.changes.length || proposal.changes.length > 12) throw Object.assign(new Error('Invalid GitHub proposal changes.'), { statusCode: 400 });
  for (const change of proposal.changes) {
    if (!change?.path || isProtectedWritePath(change.path)) throw Object.assign(new Error('GitHub proposal contains a protected path.'), { statusCode: 403 });
    if (!change.delete && typeof change.content !== 'string') throw Object.assign(new Error('GitHub proposal contains invalid file content.'), { statusCode: 400 });
  }
  return proposal;
}

function branchSlug(task, proposalToken) {
  const slug = String(task || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 38) || 'task';
  const suffix = crypto.createHash('sha256').update(String(proposalToken || '')).digest('hex').slice(0, 10);
  return `agent/${slug}-${suffix}`;
}

export async function openPullRequestFromProposal(proposalToken) {
  const proposal = verifyProposalToken(proposalToken);
  const currentRef = await githubRequest(`/repos/${proposal.repo}/git/ref/heads/${encodeURIComponent(proposal.baseBranch)}`);
  if (currentRef?.object?.sha !== proposal.baseSha) {
    throw Object.assign(new Error('The base branch changed after review. Run the agents again before opening a PR.'), { statusCode: 409 });
  }

  const treeEntries = [];
  for (const change of proposal.changes) {
    if (change.delete) {
      treeEntries.push({ path: change.path, mode: change.mode || '100644', type: 'blob', sha: null });
      continue;
    }
    const blob = await githubRequest(`/repos/${proposal.repo}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: change.content, encoding: 'utf-8' }),
    });
    treeEntries.push({ path: change.path, mode: change.mode || '100644', type: 'blob', sha: blob.sha });
  }

  const tree = await githubRequest(`/repos/${proposal.repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: proposal.baseTreeSha, tree: treeEntries }),
  });
  const commit = await githubRequest(`/repos/${proposal.repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message: `feat(agent): ${proposal.task.slice(0, 72)}`,
      tree: tree.sha,
      parents: [proposal.baseSha],
    }),
  });

  const branch = branchSlug(proposal.task, proposalToken);
  await githubRequest(`/repos/${proposal.repo}/git/refs`, {
    method: 'POST',
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: commit.sha }),
  });

  try {
    const pr = await githubRequest(`/repos/${proposal.repo}/pulls`, {
      method: 'POST',
      body: JSON.stringify({
        title: `Agent: ${proposal.task.slice(0, 72)}`,
        head: branch,
        base: proposal.baseBranch,
        body: [
          '## ForgePair controlled agent',
          '',
          proposal.review?.summary || 'DevAgent + ReviewerAgent approved this proposal.',
          '',
          `Review score: ${proposal.review?.score ?? '—'}/100`,
          '',
          'Safety: created on an `agent/...` branch. No merge or deploy was performed.',
        ].join('\n'),
      }),
    });
    return { repo: proposal.repo, branch, commitSha: commit.sha, number: pr.number, url: pr.html_url };
  } catch (error) {
    await githubRequest(`/repos/${proposal.repo}/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'DELETE' }).catch(() => {});
    throw error;
  }
}

export const githubInternals = {
  normalizeRepo,
  isSensitivePath,
  selectSnapshotEntries,
  scorePath,
  changedFilesForProposal,
  branchSlug,
};
