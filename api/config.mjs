import { handler } from '../netlify/functions/config.mjs';
import { runNetlifyHandlerOnVercel } from '../src/vercel-adapter.mjs';

export default async function vercelConfig(req, res) {
  return runNetlifyHandlerOnVercel(handler, req, res);
}
