import { handler } from '../netlify/functions/starter.mjs';
import { runNetlifyHandlerOnVercel } from '../src/vercel-adapter.mjs';

export default async function vercelStarter(req, res) {
  return runNetlifyHandlerOnVercel(handler, req, res);
}
