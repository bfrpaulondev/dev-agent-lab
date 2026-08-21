import { allowedRepos, githubConfigured } from '../../src/github-runtime.mjs';
import { assertSameOrigin, json, publicError, statusForError } from './_common.mjs';

export const handler = async event => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed.' });
  try {
    assertSameOrigin(event);
    if (!githubConfigured()) throw Object.assign(new Error('Controlled GitHub mode is not configured on the server.'), { statusCode: 503 });
    return json(200, { repos: allowedRepos() });
  } catch (error) {
    console.error('[github-repos]', error instanceof Error ? error.message : error);
    return json(statusForError(error), { error: publicError(error) });
  }
};
