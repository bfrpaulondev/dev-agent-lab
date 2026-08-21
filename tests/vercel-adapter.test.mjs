import test from 'node:test';
import assert from 'node:assert/strict';
import { runNetlifyHandlerOnVercel, toNetlifyEvent } from '../src/vercel-adapter.mjs';
import { config as sandboxConfig } from '../api/run.mjs';
import { config as githubConfig } from '../api/github/run.mjs';

test('Vercel adapter preserves method, headers, path and JSON body for existing handlers', () => {
  const event = toNetlifyEvent({
    method: 'POST',
    url: '/api/github/run?source=test',
    headers: {
      host: 'forgepair.vercel.app',
      origin: 'https://forgepair.vercel.app',
      'x-forwarded-proto': 'https',
      'x-forgepair-access': 'operator-key',
    },
    body: { task: 'test', repo: 'owner/repo' },
  });

  assert.equal(event.httpMethod, 'POST');
  assert.equal(event.path, '/api/github/run');
  assert.equal(event.rawUrl, 'https://forgepair.vercel.app/api/github/run?source=test');
  assert.deepEqual(JSON.parse(event.body), { task: 'test', repo: 'owner/repo' });
  assert.equal(event.headers['x-forgepair-access'], 'operator-key');
});

test('Vercel adapter forwards status, headers and body from a Netlify-style handler', async () => {
  const headers = new Map();
  let ended = null;
  const res = {
    statusCode: 0,
    setHeader(name, value) { headers.set(name.toLowerCase(), value); },
    end(value) { ended = value; },
  };

  await runNetlifyHandlerOnVercel(async event => ({
    statusCode: 201,
    headers: { 'Content-Type': 'application/json', 'X-Test-Path': event.path },
    body: JSON.stringify({ ok: true }),
  }), { method: 'GET', url: '/api/config', headers: { host: 'forgepair.vercel.app' } }, res);

  assert.equal(res.statusCode, 201);
  assert.equal(headers.get('content-type'), 'application/json');
  assert.equal(headers.get('x-test-path'), '/api/config');
  assert.equal(ended, '{"ok":true}');
});

test('OpenAI agent routes reserve 300 seconds on Vercel', () => {
  assert.equal(sandboxConfig.maxDuration, 300);
  assert.equal(githubConfig.maxDuration, 300);
});
