import { allowedRepos, githubConfigured } from '../../src/github-runtime.mjs';
import { groqKey, json } from './_common.mjs';

export const handler = async () => json(200, {
  groqConfigured: Boolean(groqKey()),
  githubConfigured: githubConfigured(),
  allowedRepos: githubConfigured() ? allowedRepos() : [],
  devModel: process.env.DEV_MODEL || 'qwen/qwen3.6-27b',
  reviewModel: process.env.REVIEW_MODEL || 'openai/gpt-oss-120b',
  maxReviewCycles: Number(process.env.MAX_REVIEW_CYCLES || 2),
  safety: [
    'sandbox mode remains virtual only',
    'GitHub mode reads allowlisted repositories only',
    'approved changes can create agent/* branches and pull requests only',
    'no main writes, merge, deploy, shell, secrets or protected-path writes',
  ],
});
