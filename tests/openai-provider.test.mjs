import test from 'node:test';
import assert from 'node:assert/strict';
import { openaiProviderInternals } from '../src/openai-provider.mjs';

test('OpenAI provider extracts Responses API output text', () => {
  const payload = {
    output: [
      { type: 'reasoning', content: [] },
      {
        type: 'message',
        content: [
          { type: 'output_text', text: 'SUMMARY:\nDone.' },
        ],
      },
    ],
  };
  assert.equal(openaiProviderInternals.extractOutputText(payload), 'SUMMARY:\nDone.');
});

test('OpenAI provider prefers direct output_text when present', () => {
  assert.equal(openaiProviderInternals.extractOutputText({ output_text: ' direct ' }), 'direct');
});

test('OpenAI retry delay honors retry-after and reset headers', () => {
  const retryHeaders = new Headers({ 'retry-after': '2.5' });
  assert.equal(openaiProviderInternals.retryDelayMs({ headers: retryHeaders }, ''), 2750);

  const resetHeaders = new Headers({ 'x-ratelimit-reset-tokens': '1.25s' });
  assert.equal(openaiProviderInternals.retryDelayMs({ headers: resetHeaders }, ''), 1500);
});

test('OpenAI provider exposes safe billing/quota errors', () => {
  const message = openaiProviderInternals.publicOpenAIError(
    { status: 429 },
    { error: { code: 'insufficient_quota', message: 'You exceeded your current quota.' } },
    '',
  );
  assert.match(message, /credit|quota/i);
  assert.doesNotMatch(message, /sk-/i);
});
