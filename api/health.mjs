import { handler } from '../netlify/functions/health.mjs';
import { runNetlifyHandlerOnVercel } from '../src/vercel-adapter.mjs';

export default async function vercelHealth(req, res) {
  return runNetlifyHandlerOnVercel(handler, req, res);
}
