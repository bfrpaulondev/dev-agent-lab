import crypto from 'node:crypto';

const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

export function json(statusCode, payload, headers = {}) {
  return { statusCode, headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(payload) };
}

export function publicError(error) {
  const message = error instanceof Error ? error.message : 'Request failed.';
  if (/API key|Groq|GitHub|Repository|proposal|base branch|operator access|Task must|workspace|rate|too many|request is too large|origin/i.test(message)) return message.slice(0, 300);
  return 'The request could not be completed safely.';
}

export function statusForError(error) {
  return Number(error?.statusCode) || 500;
}

export function operatorAccessConfigured() {
  return Boolean(process.env.FORGEPAIR_ACCESS_KEY);
}

function accessHeader(event) {
  return event.headers?.['x-forgepair-access'] || event.headers?.['X-ForgePair-Access'] || '';
}

function isGitHubAction(event) {
  const path = String(event.path || event.rawUrl || '');
  return /(?:\/api\/github\/|github-(?:run|pr|repos))/i.test(path);
}

function assertOperatorAccess(event) {
  const expected = process.env.FORGEPAIR_ACCESS_KEY || '';
  if (!expected) {
    if (isGitHubAction(event)) throw Object.assign(new Error('ForgePair operator access is not configured on the server.'), { statusCode: 503 });
    return;
  }
  const provided = String(accessHeader(event));
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const providedBuffer = Buffer.from(provided, 'utf8');
  if (expectedBuffer.length !== providedBuffer.length || !crypto.timingSafeEqual(expectedBuffer, providedBuffer)) {
    throw Object.assign(new Error('ForgePair operator access was rejected.'), { statusCode: 401 });
  }
}

export function assertSameOrigin(event) {
  assertOperatorAccess(event);
  const origin = event.headers?.origin || event.headers?.Origin;
  if (!origin) return;
  const host = event.headers?.['x-forwarded-host'] || event.headers?.host || event.headers?.Host;
  let parsed;
  try { parsed = new URL(origin); } catch { throw Object.assign(new Error('Invalid origin.'), { statusCode: 403 }); }
  if (!host || parsed.host !== host) throw Object.assign(new Error('Cross-origin requests are not allowed.'), { statusCode: 403 });
}

export function parseBody(event, maxBytes = 750_000) {
  const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : String(event.body || '');
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) throw Object.assign(new Error('Request is too large.'), { statusCode: 413 });
  try { return JSON.parse(raw || '{}'); } catch { throw Object.assign(new Error('Invalid JSON request.'), { statusCode: 400 }); }
}

export function groqKey() {
  return process.env[['GROQ', 'API', 'KEY'].join('_')];
}

export const commonInternals = { accessHeader, isGitHubAction };
