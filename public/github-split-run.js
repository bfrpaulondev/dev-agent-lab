const nativeFetch = globalThis.fetch.bind(globalThis);

function requestUrl(input) {
  if (typeof input === 'string') return new URL(input, globalThis.location.origin);
  if (input instanceof URL) return new URL(input.href);
  if (typeof input?.url === 'string') return new URL(input.url, globalThis.location.origin);
  return null;
}

function requestMethod(input, init) {
  return String(init?.method || input?.method || 'GET').toUpperCase();
}

function reviewTokenFromNdjson(text) {
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event?.type === 'review_stage_ready' && typeof event.reviewToken === 'string') return event.reviewToken;
    } catch {
      // The normal app parser will report malformed NDJSON if this ever happens.
    }
  }
  return null;
}

globalThis.fetch = async (input, init) => {
  const url = requestUrl(input);
  if (!url || url.origin !== globalThis.location.origin || url.pathname !== '/api/github/run' || requestMethod(input, init) !== 'POST') {
    return nativeFetch(input, init);
  }

  const devResponse = await nativeFetch(input, init);
  if (!devResponse.ok) return devResponse;
  const devText = await devResponse.text();
  const reviewToken = reviewTokenFromNdjson(devText);
  if (!reviewToken) {
    return new Response(devText, {
      status: devResponse.status,
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  const headers = new Headers(init?.headers || {});
  headers.set('Content-Type', 'application/json');
  const reviewResponse = await nativeFetch('/.netlify/functions/github-review', {
    method: 'POST',
    headers,
    body: JSON.stringify({ reviewToken }),
  });
  if (!reviewResponse.ok) return reviewResponse;

  const reviewText = await reviewResponse.text();
  return new Response(`${devText}${reviewText}`, {
    status: 200,
    headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' },
  });
};
