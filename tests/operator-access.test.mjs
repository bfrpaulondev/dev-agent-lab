import test from 'node:test';
import assert from 'node:assert/strict';
import { assertSameOrigin, operatorAccessConfigured } from '../netlify/functions/_common.mjs';

function restore(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test('controlled GitHub actions are unavailable when operator access is not configured', () => {
  const previous = process.env.FORGEPAIR_ACCESS_KEY;
  delete process.env.FORGEPAIR_ACCESS_KEY;
  try {
    assert.equal(operatorAccessConfigured(), false);
    assert.throws(
      () => assertSameOrigin({ path: '/api/github/run', headers: {} }),
      error => error?.statusCode === 503 && /operator access/i.test(error.message),
    );
  } finally {
    restore('FORGEPAIR_ACCESS_KEY', previous);
  }
});

test('configured operator access rejects missing or wrong keys', () => {
  const previous = process.env.FORGEPAIR_ACCESS_KEY;
  process.env.FORGEPAIR_ACCESS_KEY = 'correct-long-test-key';
  try {
    assert.throws(
      () => assertSameOrigin({ path: '/api/run', headers: {} }),
      error => error?.statusCode === 401,
    );
    assert.throws(
      () => assertSameOrigin({ path: '/api/run', headers: { 'x-forgepair-access': 'wrong' } }),
      error => error?.statusCode === 401,
    );
  } finally {
    restore('FORGEPAIR_ACCESS_KEY', previous);
  }
});

test('correct operator key still enforces same-origin requests', () => {
  const previous = process.env.FORGEPAIR_ACCESS_KEY;
  process.env.FORGEPAIR_ACCESS_KEY = 'correct-long-test-key';
  try {
    assert.doesNotThrow(() => assertSameOrigin({
      path: '/api/github/run',
      headers: {
        'x-forgepair-access': 'correct-long-test-key',
        host: 'forgepair.example',
        origin: 'https://forgepair.example',
      },
    }));
    assert.throws(
      () => assertSameOrigin({
        path: '/api/github/run',
        headers: {
          'x-forgepair-access': 'correct-long-test-key',
          host: 'forgepair.example',
          origin: 'https://evil.example',
        },
      }),
      error => error?.statusCode === 403 && /cross-origin/i.test(error.message),
    );
  } finally {
    restore('FORGEPAIR_ACCESS_KEY', previous);
  }
});
