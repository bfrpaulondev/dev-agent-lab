import { handler } from '../netlify/functions/run.mjs';
import { runNetlifyHandlerOnVercel } from '../src/vercel-adapter.mjs';

export const maxDuration = 300;

export default async function vercelRun(req, res) {
  return runNetlifyHandlerOnVercel(handler, req, res);
}
