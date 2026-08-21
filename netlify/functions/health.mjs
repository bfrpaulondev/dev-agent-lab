import { groqKey, json } from './_common.mjs';

export const handler = async () => json(200, {
  status: 'ok',
  groqConfigured: Boolean(groqKey()),
  runtime: 'netlify-functions',
});
