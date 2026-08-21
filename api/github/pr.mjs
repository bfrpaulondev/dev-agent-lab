import { handler } from '../../netlify/functions/github-pr.mjs';
import { runNetlifyHandlerOnVercel } from '../../src/vercel-adapter.mjs';

export default async function vercelGitHubPr(req, res) {
  return runNetlifyHandlerOnVercel(handler, req, res);
}
