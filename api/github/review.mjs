import { handler } from '../../netlify/functions/github-review.mjs';
import { runNetlifyHandlerOnVercel } from '../../src/vercel-adapter.mjs';

export const config = { maxDuration: 300 };

export default async function vercelGitHubReview(req, res) {
  return runNetlifyHandlerOnVercel(handler, req, res);
}
