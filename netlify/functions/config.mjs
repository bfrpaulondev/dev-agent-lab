import { githubConfigured } from '../../src/github-runtime.mjs';
import { json, openaiKey, operatorAccessConfigured } from './_common.mjs';

export const handler = async () => json(200, {
  openaiConfigured: Boolean(openaiKey()),
  provider: 'openai',
  accessConfigured: operatorAccessConfigured(),
  githubConfigured: githubConfigured() && operatorAccessConfigured(),
  devModel: process.env.DEV_MODEL || 'gpt-5.4-mini',
  reviewModel: process.env.REVIEW_MODEL || 'gpt-5.4-mini',
  maxReviewCycles: Number(process.env.MAX_REVIEW_CYCLES || 2),
  githubSplitExecution: true,
  safety: [
    'sandbox mode remains virtual only',
    'agent actions require operator access when configured',
    'GitHub mode reads allowlisted repositories only',
    'approved changes can create agent/* branches and pull requests only',
    'no main writes, merge, deploy, shell, secrets or protected-path writes',
  ],
});
