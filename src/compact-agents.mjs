import { openaiText } from './openai-provider.mjs';
import { VirtualWorkspace } from './workspace.mjs';

const DEFAULT_DEV_MODEL = 'gpt-5.4-mini';
const DEFAULT_REVIEW_MODEL = 'gpt-5-mini';
const MAX_TASK_CHARS = 6_000;
const MAX_DIFF_CHARS = 80_000;
const MAX_CHANGES = 12;

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

function modelReasoningEffort(model, agent = 'dev') {
  const name = String(model || '');
  if (name.startsWith('gpt-5.4-')) return agent === 'reviewer' ? 'none' : 'low';
  if (name.startsWith('gpt-5')) return 'low';
  return 'low';
}

function workspacePayload(workspace) {
  return JSON.stringify(workspace.snapshot());
}

function parseDevEnvelope(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim();
  const changesWithIndex = [];
  const filePattern = /<<<FILE path="([^"\n]+)">>>\n([\s\S]*?)\n<<<END FILE>>>/g;
  const deletePattern = /<<<DELETE path="([^"\n]+)">>>/g;
  let match;

  while ((match = filePattern.exec(text))) {
    changesWithIndex.push({ index: match.index, change: { path: match[1].trim(), content: match[2] } });
  }
  while ((match = deletePattern.exec(text))) {
    changesWithIndex.push({ index: match.index, change: { path: match[1].trim(), delete: true } });
  }

  changesWithIndex.sort((a, b) => a.index - b.index);
  const changes = changesWithIndex.map(item => item.change);
  if (!changes.length && !/\bNO_CHANGES\b/.test(text)) {
    throw new Error('DevAgent returned an invalid file envelope.');
  }

  const firstChangeIndex = changesWithIndex[0]?.index ?? text.indexOf('NO_CHANGES');
  const summaryStart = text.match(/^SUMMARY:\s*\n?/i)?.[0]?.length ?? 0;
  const summaryEnd = firstChangeIndex >= 0 ? firstChangeIndex : text.length;
  const summary = text.slice(summaryStart, summaryEnd).trim().slice(0, 2000) || `Updated ${changes.length} file(s).`;
  return { summary, changes };
}

function parseReviewEnvelope(raw) {
  const text = String(raw || '').replace(/\r\n/g, '\n').trim();
  const verdictMatch = text.match(/^VERDICT:\s*(approve|changes_requested)\s*$/im);
  if (!verdictMatch) throw new Error('ReviewerAgent returned an invalid review envelope.');
  const scoreMatch = text.match(/^SCORE:\s*([0-9]{1,3}(?:\.[0-9]+)?)\s*$/im);

  const findings = [];
  const findingPattern = /<<<FINDING>>>\n([\s\S]*?)\n<<<END FINDING>>>/g;
  let findingMatch;
  while ((findingMatch = findingPattern.exec(text))) {
    const block = findingMatch[1];
    const severity = block.match(/^SEVERITY:\s*(critical|high|medium|low)\s*$/im)?.[1]?.toLowerCase() || 'medium';
    const file = block.match(/^FILE:\s*(.*?)\s*$/im)?.[1]?.trim() || null;
    const title = block.match(/^TITLE:\s*(.*?)\s*$/im)?.[1]?.trim() || 'Finding';
    const detail = block.match(/^DETAIL:\s*\n([\s\S]*)$/im)?.[1]?.trim() || '';
    findings.push({ severity, file, title, detail });
  }

  const summaryMarker = text.search(/^SUMMARY:\s*$/im);
  let summary = 'Review completed.';
  if (summaryMarker >= 0) {
    const afterMarker = text.slice(summaryMarker).replace(/^SUMMARY:\s*\n?/i, '');
    const firstFinding = afterMarker.indexOf('<<<FINDING>>>');
    summary = (firstFinding >= 0 ? afterMarker.slice(0, firstFinding) : afterMarker).trim() || summary;
  }

  return {
    verdict: verdictMatch[1].toLowerCase(),
    score: Number(scoreMatch?.[1] || 0),
    summary: summary.slice(0, 1600),
    findings,
  };
}

function applyCompactChanges(workspace, changes) {
  if (!Array.isArray(changes)) throw new Error('DevAgent response must include a changes array.');
  if (changes.length > MAX_CHANGES) throw new Error(`DevAgent requested too many file changes (${changes.length}).`);

  const applied = [];
  for (const item of changes) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid DevAgent file change.');
    const filePath = typeof item.path === 'string' ? item.path : '';
    if (!filePath) throw new Error('DevAgent file change is missing a path.');
    if (item.delete === true) {
      const result = workspace.deleteFile(filePath);
      applied.push({ path: filePath, operation: 'delete', result });
      continue;
    }
    if (typeof item.content !== 'string') throw new Error(`DevAgent change for ${filePath} is missing file content.`);
    const result = workspace.writeFile(filePath, item.content);
    applied.push({ path: filePath, operation: result.operation, result });
  }
  return applied;
}

function normalizeReview(parsed) {
  const findings = Array.isArray(parsed?.findings)
    ? parsed.findings.slice(0, 10).map(item => ({
        severity: ['critical', 'high', 'medium', 'low'].includes(item?.severity) ? item.severity : 'medium',
        title: String(item?.title || 'Finding').slice(0, 180),
        detail: String(item?.detail || '').slice(0, 1000),
        file: item?.file ? String(item.file).slice(0, 180) : null,
      }))
    : [];
  let verdict = parsed?.verdict === 'approve' ? 'approve' : 'changes_requested';
  if (findings.some(item => item.severity === 'critical' || item.severity === 'high')) verdict = 'changes_requested';
  return {
    verdict,
    score: Math.max(0, Math.min(100, Number(parsed?.score) || 0)),
    summary: String(parsed?.summary || 'Review completed.').slice(0, 1600),
    findings,
  };
}

function reviewerFeedback(review) {
  return review.findings.map((item, index) => `${index + 1}. [${item.severity.toUpperCase()}] ${item.title}${item.file ? ` (${item.file})` : ''}: ${item.detail}`).join('\n');
}

async function runCompactDev({ apiKey, task, workspace, reviewFeedback = '', emit = () => {}, model }) {
  emit({ type: 'agent_start', agent: 'dev', model });
  const user = reviewFeedback
    ? `TASK:\n${task}\n\nVERIFIED REVIEW FINDINGS:\n${reviewFeedback}\n\nCURRENT WORKSPACE JSON:\n${workspacePayload(workspace)}\n\nCorrect only verified issues. Follow the exact plain-text FILE envelope from the system instruction.`
    : `TASK:\n${task}\n\nWORKSPACE JSON:\n${workspacePayload(workspace)}\n\nImplement the smallest coherent solution. Follow the exact plain-text FILE envelope from the system instruction and include only changed files.`;

  const response = await openaiText({
    apiKey,
    model,
    instructions: DEV_SYSTEM,
    input: user,
    reasoningEffort: modelReasoningEffort(model, 'dev'),
    maxOutputTokens: 2_600,
  });
  const parsed = parseDevEnvelope(response.content);
  const applied = applyCompactChanges(workspace, parsed.changes);
  for (const item of applied) emit({ type: 'tool_finish', agent: 'dev', tool: item.operation === 'delete' ? 'delete_file' : 'write_file', path: item.path, outcome: item.operation });
  const quality = workspace.qualityReport();
  emit({ type: 'tool_finish', agent: 'dev', tool: 'run_quality_checks', findings: quality.findings.length, outcome: 'checked' });
  emit({ type: 'tool_finish', agent: 'dev', tool: 'get_diff', changed: Boolean(workspace.diff()), outcome: 'inspected' });
  emit({ type: 'agent_finish', agent: 'dev', summary: parsed.summary, turn: 1 });
  return { summary: parsed.summary, usage: response.usage, turns: 1 };
}

async function runCompactReviewer({ apiKey, task, workspace, quality, emit = () => {}, model }) {
  emit({ type: 'agent_start', agent: 'reviewer', model });
  const user = `TASK:\n${task}\n\nQUALITY REPORT:\n${JSON.stringify(quality)}\n\nDIFF:\n${workspace.diff().slice(0, MAX_DIFF_CHARS) || '(no changes)'}\n\nFollow the exact plain-text review envelope from the system instruction.`;
  const response = await openaiText({
    apiKey,
    model,
    instructions: REVIEW_SYSTEM,
    input: user,
    reasoningEffort: modelReasoningEffort(model, 'reviewer'),
    maxOutputTokens: 1_200,
  });
  const review = normalizeReview(parseReviewEnvelope(response.content));
  emit({ type: 'agent_finish', agent: 'reviewer', verdict: review.verdict, score: review.score, findings: review.findings.length, summary: review.summary });
  return { ...review, usage: response.usage };
}

export async function runCompactAgentPair({ apiKey, task, seed, emit = () => {} }) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured on the server.');
  if (typeof task !== 'string' || !task.trim() || task.length > MAX_TASK_CHARS) throw new Error('Task must be between 1 and 6000 characters.');

  const devModel = process.env.DEV_MODEL || DEFAULT_DEV_MODEL;
  const reviewModel = process.env.REVIEW_MODEL || DEFAULT_REVIEW_MODEL;
  const maxCycles = Math.max(1, Math.min(Number(process.env.MAX_COMPACT_REVIEW_CYCLES || 2), 2));
  const workspace = new VirtualWorkspace(seed);
  const history = [];

  let dev = await runCompactDev({ apiKey, task: task.trim(), workspace, emit, model: devModel });
  for (let cycle = 1; cycle <= maxCycles; cycle += 1) {
    const quality = workspace.qualityReport();
    const review = await runCompactReviewer({ apiKey, task: task.trim(), workspace, quality, emit, model: reviewModel });
    history.push({ cycle, dev, review, quality });
    if (review.verdict === 'approve') {
      return { status: 'approved', task, files: workspace.snapshot(), diff: workspace.diff(), quality, history, operations: workspace.operations };
    }
    if (cycle === maxCycles) {
      return { status: 'changes_requested', task, files: workspace.snapshot(), diff: workspace.diff(), quality, history, operations: workspace.operations };
    }
    emit({ type: 'cycle', cycle: cycle + 1, message: 'Reviewer requested changes; sending verified findings back to DevAgent.' });
    dev = await runCompactDev({ apiKey, task: task.trim(), workspace, reviewFeedback: reviewerFeedback(review), emit, model: devModel });
  }
}

export const compactInternals = { applyCompactChanges, normalizeReview, parseDevEnvelope, parseReviewEnvelope, modelReasoningEffort };
