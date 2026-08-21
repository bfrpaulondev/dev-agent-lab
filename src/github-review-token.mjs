import crypto from 'node:crypto';
import { assertAllowedRepo, githubToken, isProtectedWritePath } from './github-runtime.mjs';

const REVIEW_STAGE_TTL_MS = 10 * 60 * 1000;
const MAX_STAGE_CHANGES = 12;

function signingKey() {
  const token = githubToken();
  if (!token) throw new Error('GitHub review-stage signing key unavailable.');
  return crypto.createHash('sha256').update(`forgepair-review-stage-v1:${token}`).digest();
}

function changedFiles(snapshot, result) {
  const changed = [];
  const paths = [...new Set((result?.operations || []).map(item => item.path).filter(Boolean))];
  if (paths.length > MAX_STAGE_CHANGES) throw new Error('DevAgent requested too many GitHub changes.');

  for (const filePath of paths) {
    if (isProtectedWritePath(filePath)) throw new Error(`Protected GitHub path: ${filePath}`);
    const beforeExists = Object.prototype.hasOwnProperty.call(snapshot.files || {}, filePath);
    if (!beforeExists && snapshot.existingPaths?.has(filePath)) {
      throw new Error(`Cannot replace unseen existing GitHub file: ${filePath}`);
    }
    const afterExists = Object.prototype.hasOwnProperty.call(result.files || {}, filePath);
    if (beforeExists && afterExists && snapshot.files[filePath] === result.files[filePath]) continue;
    if (!afterExists) {
      changed.push({ path: filePath, delete: true, mode: snapshot.metadata?.[filePath]?.mode || '100644' });
      continue;
    }
    changed.push({
      path: filePath,
      content: result.files[filePath],
      mode: snapshot.metadata?.[filePath]?.mode || '100644',
    });
  }
  return changed;
}

export function createReviewStageToken(snapshot, task, devResult) {
  const changes = changedFiles(snapshot, devResult);
  if (!changes.length) throw Object.assign(new Error('DevAgent produced no GitHub changes to review.'), { statusCode: 422 });

  const payload = {
    version: 1,
    kind: 'github-review-stage',
    repo: snapshot.repo,
    baseBranch: snapshot.baseBranch,
    baseSha: snapshot.baseSha,
    baseTreeSha: snapshot.baseTreeSha,
    task: String(task || '').trim().slice(0, 6_000),
    createdAt: Date.now(),
    expiresAt: Date.now() + REVIEW_STAGE_TTL_MS,
    changes,
    dev: {
      summary: String(devResult?.dev?.summary || 'DevAgent completed.').slice(0, 2_000),
      turns: Number(devResult?.dev?.turns || 1),
      usage: devResult?.dev?.usage ?? null,
    },
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto.createHmac('sha256', signingKey()).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

export function verifyReviewStageToken(token) {
  const [encoded, signature, extra] = String(token || '').split('.');
  if (!encoded || !signature || extra) throw Object.assign(new Error('Invalid GitHub review-stage token.'), { statusCode: 400 });

  const expected = crypto.createHmac('sha256', signingKey()).update(encoded).digest();
  let received;
  try {
    received = Buffer.from(signature, 'base64url');
  } catch {
    throw Object.assign(new Error('Invalid GitHub review-stage token.'), { statusCode: 400 });
  }
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    throw Object.assign(new Error('GitHub review-stage signature is invalid.'), { statusCode: 403 });
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    throw Object.assign(new Error('Invalid GitHub review-stage payload.'), { statusCode: 400 });
  }

  if (payload.version !== 1 || payload.kind !== 'github-review-stage' || Date.now() > Number(payload.expiresAt || 0)) {
    throw Object.assign(new Error('GitHub review stage expired or is unsupported.'), { statusCode: 409 });
  }
  payload.repo = assertAllowedRepo(payload.repo);
  if (!payload.task || typeof payload.task !== 'string' || payload.task.length > 6_000) {
    throw Object.assign(new Error('Invalid GitHub review-stage task.'), { statusCode: 400 });
  }
  if (!Array.isArray(payload.changes) || !payload.changes.length || payload.changes.length > MAX_STAGE_CHANGES) {
    throw Object.assign(new Error('Invalid GitHub review-stage changes.'), { statusCode: 400 });
  }
  for (const change of payload.changes) {
    if (!change?.path || isProtectedWritePath(change.path)) {
      throw Object.assign(new Error('GitHub review stage contains a protected path.'), { statusCode: 403 });
    }
    if (!change.delete && typeof change.content !== 'string') {
      throw Object.assign(new Error('GitHub review stage contains invalid file content.'), { statusCode: 400 });
    }
  }
  return payload;
}

export const reviewTokenInternals = { changedFiles };
