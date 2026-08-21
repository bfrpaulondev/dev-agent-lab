import { handler } from '../../netlify/functions/github-repos.mjs';
import { runNetlifyHandlerOnVercel } from '../../src/vercel-adapter.mjs';

export default async function vercelGitHubRepos(req, res) {
  return runNetlifyHandlerOnVercel(handler, req, res);
}
