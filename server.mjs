import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAgentPair } from './src/agents.mjs';
import { starterWorkspace } from './src/fixture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');

await loadLocalEnv();

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
const runWindows = new Map();
const RUN_WINDOW_MS = 5 * 60 * 1000;
const MAX_RUNS_PER_WINDOW = 8;
const MAX_BODY_BYTES = 750_000;

const server = http.createServer(async (req, res) => {
  applySecurityHeaders(res);
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      return json(res, 200, { status: 'ok', groqConfigured: Boolean(process.env.GROQ_API_KEY) });
    }

    if (req.method === 'GET' && url.pathname === '/api/config') {
      return json(res, 200, {
        groqConfigured: Boolean(process.env.GROQ_API_KEY),
        devModel: process.env.DEV_MODEL || 'qwen/qwen3.6-27b',
        reviewModel: process.env.REVIEW_MODEL || 'openai/gpt-oss-120b',
        maxReviewCycles: Number(process.env.MAX_REVIEW_CYCLES || 2),
        safety: ['virtual workspace only', 'no shell', 'no GitHub writes', 'no production actions'],
      });
    }

    if (req.method === 'GET' && url.pathname === '/api/starter') {
      return json(res, 200, { files: starterWorkspace });
    }

    if (req.method === 'POST' && url.pathname === '/api/run') {
      assertSameOrigin(req);
      assertRateLimit(req);
      const body = await readJsonBody(req);
      const task = typeof body.task === 'string' ? body.task : '';
      const seed = body.files && typeof body.files === 'object' && !Array.isArray(body.files) ? body.files : starterWorkspace;

      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Accel-Buffering': 'no',
      });
      const send = payload => {
        if (!res.destroyed && !res.writableEnded) res.write(`${JSON.stringify(payload)}\n`);
      };
      send({ type: 'run_start', startedAt: new Date().toISOString() });
      try {
        const result = await runAgentPair({
          apiKey: process.env.GROQ_API_KEY,
          task,
          seed,
          emit: send,
        });
        send({ type: 'result', result });
      } catch (error) {
        console.error('[agent-run]', error instanceof Error ? error.message : error);
        send({ type: 'error', message: publicError(error) });
      } finally {
        res.end();
      }
      return;
    }

    if (req.method === 'GET') return serveStatic(url.pathname, res);
    return json(res, 405, { error: 'Method not allowed.' });
  } catch (error) {
    console.error('[request]', error instanceof Error ? error.message : error);
    if (!res.headersSent) return json(res, statusForError(error), { error: publicError(error) });
    res.end();
  }
});

server.listen(port, host, () => {
  console.log(`DevAgent Lab running at http://${host}:${port}`);
  console.log(`Groq configured: ${Boolean(process.env.GROQ_API_KEY)}`);
});

async function loadLocalEnv() {
  for (const filename of ['.env.local', '.env']) {
    try {
      const raw = await fs.readFile(path.join(__dirname, filename), 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const index = trimmed.indexOf('=');
        if (index < 1) continue;
        const key = trimmed.slice(0, index).trim();
        let value = trimmed.slice(index + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
        if (!(key in process.env)) process.env[key] = value;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
}

function assertSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return;
  const host = req.headers.host;
  let parsed;
  try { parsed = new URL(origin); } catch { throw Object.assign(new Error('Invalid origin.'), { statusCode: 403 }); }
  if (!host || parsed.host !== host) throw Object.assign(new Error('Cross-origin requests are not allowed.'), { statusCode: 403 });
}

function clientKey(req) {
  return String(req.socket.remoteAddress || 'unknown');
}

function assertRateLimit(req) {
  const key = clientKey(req);
  const now = Date.now();
  const entry = runWindows.get(key);
  if (!entry || now - entry.startedAt > RUN_WINDOW_MS) {
    runWindows.set(key, { startedAt: now, count: 1 });
    return;
  }
  entry.count += 1;
  if (entry.count > MAX_RUNS_PER_WINDOW) throw Object.assign(new Error('Too many agent runs. Try again shortly.'), { statusCode: 429 });
}

async function readJsonBody(req) {
  let raw = '';
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > MAX_BODY_BYTES) throw Object.assign(new Error('Request is too large.'), { statusCode: 413 });
    raw += chunk.toString('utf8');
  }
  try { return JSON.parse(raw || '{}'); } catch { throw Object.assign(new Error('Invalid JSON request.'), { statusCode: 400 }); }
}

async function serveStatic(pathname, res) {
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const normalized = path.posix.normalize(relative);
  if (normalized.startsWith('../') || normalized.includes('/../')) return json(res, 404, { error: 'Not found.' });
  const filePath = path.join(publicDir, normalized);
  if (!filePath.startsWith(publicDir + path.sep) && filePath !== path.join(publicDir, 'index.html')) return json(res, 404, { error: 'Not found.' });
  try {
    const content = await fs.readFile(filePath);
    const type = normalized.endsWith('.css') ? 'text/css; charset=utf-8' : normalized.endsWith('.js') ? 'text/javascript; charset=utf-8' : normalized.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': normalized === 'index.html' ? 'no-cache' : 'public, max-age=300' });
    res.end(content);
  } catch (error) {
    if (error?.code === 'ENOENT') return json(res, 404, { error: 'Not found.' });
    throw error;
  }
}

function publicError(error) {
  const message = error instanceof Error ? error.message : 'Request failed.';
  if (/API key|Groq|Task must|workspace|rate|too many|request is too large|origin/i.test(message)) return message.slice(0, 300);
  return 'The request could not be completed safely.';
}

function statusForError(error) {
  return Number(error?.statusCode) || 500;
}

function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}
