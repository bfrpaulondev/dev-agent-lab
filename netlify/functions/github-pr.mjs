import { openPullRequestFromProposal } from '../../src/github-runtime.mjs';
import { assertSameOrigin, json, parseBody, publicError, statusForError } from './_common.mjs';

export const handler = async event => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  try {
    assertSameOrigin(event);
    const body = parseBody(event, 900_000);
    const proposalToken = typeof body.proposalToken === 'string' ? body.proposalToken : '';
    if (!proposalToken) throw Object.assign(new Error('Approved GitHub proposal is required.'), { statusCode: 400 });
    const result = await openPullRequestFromProposal(proposalToken);
    return json(201, result);
  } catch (error) {
    console.error('[github-open-pr]', error instanceof Error ? error.message : error);
    return json(statusForError(error), { error: publicError(error) });
  }
};
