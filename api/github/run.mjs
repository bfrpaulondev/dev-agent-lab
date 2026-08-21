import { handler } from '../../netlify/functions/github-run.mjs';
import { runNetlifyHandlerOnVercel } from '../../src/vercel-adapter.mjs';

export const maxDuration = 300;

export default async function vercelGitHubRun(req, res) {
  return runNetlifyHandlerOnVercel(handler, req, res);
}
