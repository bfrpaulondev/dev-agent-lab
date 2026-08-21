import test from 'node:test';
import assert from 'node:assert/strict';
import { handler as health } from '../netlify/functions/health.mjs';
import { handler as config } from '../netlify/functions/config.mjs';
import { handler as starter } from '../netlify/functions/starter.mjs';
import { handler as run, netlifyRunInternals } from '../netlify/functions/run.mjs';

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

test('Groq requests reduce reasoning usage for the configured coding models', () => {
  const qwen = netlifyRunInternals.prepareGroqInit({
    body: JSON.stringify({ model: 'qwen/qwen3.6-27b', messages: [] }),
  });
  assert.equal(JSON.parse(qwen.body).reasoning_effort, 'none');

  const reviewer = netlifyRunInternals.prepareGroqInit({
    body: JSON.stringify({ model: 'openai/gpt-oss-120b', messages: [] }),
  });
  assert.equal(JSON.parse(reviewer.body).reasoning_effort, 'low');
});

test('Groq rate-limit delay honors retry-after and reset headers', () => {
  const headers = new Headers({ 'retry-after': '7.5' });
  assert.equal(netlifyRunInternals.rateLimitDelayMs({ headers }, ''), 7750);

  const resetHeaders = new Headers({ 'x-ratelimit-reset-tokens': '2.25s' });
  assert.equal(netlifyRunInternals.rateLimitDelayMs({ headers: resetHeaders }, ''), 2500);

  assert.equal(
    netlifyRunInternals.rateLimitDelayMs({ headers: new Headers() }, 'Please try again in 1.5s.'),
    1750,
  );
});
