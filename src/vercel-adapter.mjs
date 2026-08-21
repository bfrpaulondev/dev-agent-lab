function bodyForEvent(req) {
  if (req?.body === undefined || req?.body === null) return '';
  if (typeof req.body === 'string') return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
  return JSON.stringify(req.body);
}

function requestPath(req) {
  return String(req?.url || '').split('?')[0] || '/';
}

export function toNetlifyEvent(req) {
  const headers = req?.headers && typeof req.headers === 'object' ? req.headers : {};
  const host = headers.host || headers.Host || 'localhost';
  const proto = headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'] || 'https';
  const path = requestPath(req);
  return {
    httpMethod: String(req?.method || 'GET').toUpperCase(),
    headers,
    body: bodyForEvent(req),
    isBase64Encoded: false,
    path,
    rawUrl: `${proto}://${host}${String(req?.url || path)}`,
  };
}

export async function runNetlifyHandlerOnVercel(handler, req, res) {
  const result = await handler(toNetlifyEvent(req));
  for (const [name, value] of Object.entries(result?.headers || {})) {
    if (value !== undefined && value !== null) res.setHeader(name, String(value));
  }
  res.statusCode = Number(result?.statusCode) || 200;
  res.end(result?.body === undefined || result?.body === null ? '' : String(result.body));
}

export const vercelAdapterInternals = { bodyForEvent, requestPath };
