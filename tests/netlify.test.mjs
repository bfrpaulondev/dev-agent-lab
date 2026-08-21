import test from 'node:test';
import assert from 'node:assert/strict';
import { handler as health } from '../netlify/functions/health.mjs';
import { handler as config } from '../netlify/functions/config.mjs';
import { handler as starter } from '../netlify/functions/starter.mjs';
import { handler as run } from '../netlify/functions/run.mjs';

test('Netlify health/config/starter handlers are deployable without a Groq key', async () => {
  const healthResponse = await health({});
  assert.equal(healthResponse.statusCode, 200);
  assert.equal(JSON.parse(healthResponse.body).runtime, 'netlify-functions');

  const configResponse = await config({});
  assert.equal(configResponse.statusCode, 200);
  assert.equal(typeof JSON.parse(configResponse.body).groqConfigured, 'boolean');

  const starterResponse = await starter({});
  assert.equal(starterResponse.statusCode, 200);
  assert.ok(JSON.parse(starterResponse.body).files['src/App.tsx']);
});

test('Netlify run handler enforces method, origin and server-side Groq configuration', async () => {
  const methodResponse = await run({ httpMethod: 'GET', headers: {} });
  assert.equal(methodResponse.statusCode, 405);

  const crossOrigin = await run({
    httpMethod: 'POST',
    headers: { host: 'lab.netlify.app', origin: 'https://evil.example' },
    body: JSON.stringify({ task: 'test' }),
  });
  assert.equal(crossOrigin.statusCode, 403);

  const envName = ['GROQ', 'API', 'KEY'].join('_');
  const previous = process.env[envName];
  delete process.env[envName];
  const missingKey = await run({
    httpMethod: 'POST',
    headers: { host: 'lab.netlify.app', origin: 'https://lab.netlify.app' },
    body: JSON.stringify({ task: 'test' }),
  });
  if (previous) process.env[envName] = previous;
  assert.equal(missingKey.statusCode, 500);
  assert.match(JSON.parse(missingKey.body).error, /GROQ_API_KEY/);
});
