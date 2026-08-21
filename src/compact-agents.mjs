import { VirtualWorkspace } from './workspace.mjs';

const DEFAULT_DEV_MODEL = 'qwen/qwen3.6-27b';
const DEFAULT_REVIEW_MODEL = 'openai/gpt-oss-120b';
const MAX_TASK_CHARS = 6_000;
const MAX_DIFF_CHARS = 80_000;
const MAX_CHANGES = 12;

const DEV_SYSTEM = `You are DevAgent, a senior full-stack engineer. Prefer simple, proven solutions. Security is non-negotiable: validate untrusted input, do not expose secrets, do not invent backend behavior, and do not represent placeholders as complete. Match the existing project instead of rewriting unrelated code. Return JSON only. You are editing a bounded virtual repository; do not claim shell, GitHub, deploy, or external test access.`;

const REVIEW_SYSTEM = `You are ReviewerAgent. Independently review the implementation against the task, security, correctness, accessibility, responsiveness and regressions. Be evidence-based and concise. Do not invent findings. A critical/high finding always requires changes. Return JSON only.`;

async function groqJson({ apiKey, model, messages, temperature = 0.1 }) {
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature,
      response_format: { type: 'json_object' },
    }),
    signal: AbortSignal.timeout(90_000),
  });

  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = null; }
  if (!response.ok) {
    const message = payload?.error?.message;
    throw new Error(response.status === 401
      ? 'Groq rejected the API key.'
      : message
        ? `Groq request failed: ${String(message).slice(0, 320)}`
        : `Groq request failed (${response.status}).`);
  }

  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') throw new Error('Groq returned an invalid compact-agent response.');
  let parsed;
  try { parsed = JSON.parse(content); } catch { throw new Error('Compact agent returned invalid JSON.'); }
  return { parsed, usage: payload.usage ?? null };
}

function workspacePayload(workspace) {
  return JSON.stringify(workspace.snapshot());
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
    ? `TASK:\n${task}\n\nVERIFIED REVIEW FINDINGS:\n${reviewFeedback}\n\nCURRENT WORKSPACE JSON:\n${workspacePayload(workspace)}\n\nCorrect only verified issues. Return JSON: {"summary":"...","changes":[{"path":"relative/path","content":"complete new UTF-8 file content"}]}. Use {"path":"...","delete":true} only when deletion is required.`
    : `TASK:\n${task}\n\nWORKSPACE JSON:\n${workspacePayload(workspace)}\n\nImplement the smallest coherent solution. Return JSON: {"summary":"...","changes":[{"path":"relative/path","content":"complete new UTF-8 file content"}]}. Include only changed files. Use {"path":"...","delete":true} only when deletion is required.`;

  const response = await groqJson({
    apiKey,
    model,
    messages: [{ role: 'system', content: DEV_SYSTEM }, { role: 'user', content: user }],
    temperature: 0.1,
  });
  const applied = applyCompactChanges(workspace, response.parsed?.changes);
  for (const item of applied) emit({ type: 'tool_finish', agent: 'dev', tool: item.operation === 'delete' ? 'delete_file' : 'write_file', path: item.path, outcome: item.operation });
  const quality = workspace.qualityReport();
  emit({ type: 'tool_finish', agent: 'dev', tool: 'run_quality_checks', findings: quality.findings.length, outcome: 'checked' });
  emit({ type: 'tool_finish', agent: 'dev', tool: 'get_diff', changed: Boolean(workspace.diff()), outcome: 'inspected' });
  const summary = String(response.parsed?.summary || `Updated ${applied.length} file(s).`).slice(0, 2000);
  emit({ type: 'agent_finish', agent: 'dev', summary, turn: 1 });
  return { summary, usage: response.usage, turns: 1 };
}

async function runCompactReviewer({ apiKey, task, workspace, quality, emit = () => {}, model }) {
  emit({ type: 'agent_start', agent: 'reviewer', model });
  const user = `TASK:\n${task}\n\nQUALITY REPORT:\n${JSON.stringify(quality)}\n\nDIFF:\n${workspace.diff().slice(0, MAX_DIFF_CHARS) || '(no changes)'}\n\nReturn JSON only: {"verdict":"approve|changes_requested","score":0,"summary":"...","findings":[{"severity":"critical|high|medium|low","title":"...","detail":"...","file":"optional"}]}.`;
  const response = await groqJson({
    apiKey,
    model,
    messages: [{ role: 'system', content: REVIEW_SYSTEM }, { role: 'user', content: user }],
    temperature: 0.05,
  });
  const review = normalizeReview(response.parsed);
  emit({ type: 'agent_finish', agent: 'reviewer', verdict: review.verdict, score: review.score, findings: review.findings.length, summary: review.summary });
  return { ...review, usage: response.usage };
}

export async function runCompactAgentPair({ apiKey, task, seed, emit = () => {} }) {
  if (!apiKey) throw new Error('GROQ_API_KEY is not configured on the server.');
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

export const compactInternals = { applyCompactChanges, normalizeReview };
