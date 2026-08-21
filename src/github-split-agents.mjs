import { openaiText } from './openai-provider.mjs';
import { VirtualWorkspace } from './workspace.mjs';
import { compactInternals } from './compact-agents.mjs';

const DEFAULT_DEV_MODEL = 'gpt-5.4-mini';
const DEFAULT_REVIEW_MODEL = 'gpt-5.4-mini';
const MAX_DIFF_CHARS = 80_000;

const DEV_SYSTEM = `You are DevAgent, a senior full-stack engineer. Prefer simple, proven solutions. Security is non-negotiable: validate untrusted input, do not expose secrets, do not invent backend behavior, and do not represent placeholders as complete. Match the existing project instead of rewriting unrelated code. You are editing a bounded virtual repository; do not claim shell, GitHub, deploy, or external test access.

Return ONLY this plain-text envelope, with no Markdown code fences and no JSON escaping:
SUMMARY:
<concise factual summary>
<<<FILE path="relative/path">>>
<complete raw UTF-8 file content>
<<<END FILE>>>

Repeat FILE blocks only for changed files. For a required deletion use exactly:
<<<DELETE path="relative/path">>>

If no file needs changing, return NO_CHANGES after SUMMARY. Never place the delimiter strings inside file content.`;

const REVIEW_SYSTEM = `You are ReviewerAgent. Independently review the implementation against the task, security, correctness, accessibility, responsiveness and regressions. Be evidence-based and concise. Do not invent findings. A critical/high finding always requires changes.

Return ONLY this plain-text envelope, with no Markdown fences and no JSON:
VERDICT: approve|changes_requested
SCORE: 0-100
SUMMARY:
<concise review summary>

For each finding append:
<<<FINDING>>>
SEVERITY: critical|high|medium|low
FILE: optional/relative/path
TITLE: concise title
DETAIL:
<evidence-based detail>
<<<END FINDING>>>

If there are no findings, omit all FINDING blocks.`;

function assertInputs(apiKey, task) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured on the server.');
  if (typeof task !== 'string' || !task.trim() || task.length > 6_000) {
    throw new Error('Task must be between 1 and 6000 characters.');
  }
}

export function applySignedChanges(workspace, changes) {
  return compactInternals.applyCompactChanges(workspace, changes);
}

export async function runGitHubDevStage({ apiKey, task, seed, emit = () => {} }) {
  assertInputs(apiKey, task);
  const workspace = new VirtualWorkspace(seed);
  const model = process.env.DEV_MODEL || DEFAULT_DEV_MODEL;
  emit({ type: 'agent_start', agent: 'dev', model });

  const input = `TASK:\n${task.trim()}\n\nWORKSPACE JSON:\n${JSON.stringify(workspace.snapshot())}\n\nImplement the smallest coherent solution. Follow the exact plain-text FILE envelope from the system instruction and include only changed files.`;
  const response = await openaiText({
    apiKey,
    model,
    instructions: DEV_SYSTEM,
    input,
    reasoningEffort: 'none',
    maxOutputTokens: 2_600,
  });

  const parsed = compactInternals.parseDevEnvelope(response.content);
  const applied = compactInternals.applyCompactChanges(workspace, parsed.changes);
  for (const item of applied) {
    emit({
      type: 'tool_finish',
      agent: 'dev',
      tool: item.operation === 'delete' ? 'delete_file' : 'write_file',
      path: item.path,
      outcome: item.operation,
    });
  }
  const quality = workspace.qualityReport();
  emit({ type: 'tool_finish', agent: 'dev', tool: 'run_quality_checks', findings: quality.findings.length, outcome: 'checked' });
  emit({ type: 'tool_finish', agent: 'dev', tool: 'get_diff', changed: Boolean(workspace.diff()), outcome: 'inspected' });
  emit({ type: 'agent_finish', agent: 'dev', summary: parsed.summary, turn: 1 });

  return {
    files: workspace.snapshot(),
    diff: workspace.diff(),
    quality,
    operations: workspace.operations,
    dev: { summary: parsed.summary, usage: response.usage, turns: 1 },
  };
}

export async function runGitHubReviewStage({ apiKey, task, workspace, emit = () => {} }) {
  assertInputs(apiKey, task);
  if (!(workspace instanceof VirtualWorkspace)) throw new Error('Reviewer stage requires a VirtualWorkspace.');

  const model = process.env.REVIEW_MODEL || DEFAULT_REVIEW_MODEL;
  const quality = workspace.qualityReport();
  emit({ type: 'agent_start', agent: 'reviewer', model });

  const input = `TASK:\n${task.trim()}\n\nQUALITY REPORT:\n${JSON.stringify(quality)}\n\nDIFF:\n${workspace.diff().slice(0, MAX_DIFF_CHARS) || '(no changes)'}\n\nFollow the exact plain-text review envelope from the system instruction.`;
  const response = await openaiText({
    apiKey,
    model,
    instructions: REVIEW_SYSTEM,
    input,
    reasoningEffort: 'none',
    maxOutputTokens: 900,
  });

  const review = compactInternals.normalizeReview(compactInternals.parseReviewEnvelope(response.content));
  const finalReview = { ...review, usage: response.usage };
  emit({
    type: 'agent_finish',
    agent: 'reviewer',
    verdict: finalReview.verdict,
    score: finalReview.score,
    findings: finalReview.findings.length,
    summary: finalReview.summary,
  });
  return { review: finalReview, quality };
}
