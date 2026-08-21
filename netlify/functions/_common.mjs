const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
};

export function json(statusCode, payload, headers = {}) {
  return { statusCode, headers: { ...JSON_HEADERS, ...headers }, body: JSON.stringify(payload) };
}

export function publicError(error) {
  const message = error instanceof Error ? error.message : 'Request failed.';
  if (/API key|Groq|GitHub|Repository|proposal|base branch|Task must|workspace|rate|too many|request is too large|origin/i.test(message)) return message.slice(0, 300);
  return 'The request could not be completed safely.';
}

export function statusForError(error) {
  return Number(error?.statusCode) || 500;
}

export function assertSameOrigin(event) {
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
