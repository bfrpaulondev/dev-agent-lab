import { json, openaiKey } from './_common.mjs';

export const handler = async () => json(200, {
  status: 'ok',
  provider: 'openai',
  openaiConfigured: Boolean(openaiKey()),
  runtime: 'netlify-functions',
});
