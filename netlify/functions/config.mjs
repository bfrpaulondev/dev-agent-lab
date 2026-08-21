import { groqKey, json } from './_common.mjs';

export const handler = async () => json(200, {
  groqConfigured: Boolean(groqKey()),
  devModel: process.env.DEV_MODEL || 'qwen/qwen3.6-27b',
  reviewModel: process.env.REVIEW_MODEL || 'openai/gpt-oss-120b',
  maxReviewCycles: Number(process.env.MAX_REVIEW_CYCLES || 2),
  safety: ['virtual workspace only', 'no shell', 'no GitHub writes', 'no production actions'],
});
