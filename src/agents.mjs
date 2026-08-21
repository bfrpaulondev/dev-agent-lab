import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VirtualWorkspace } from './workspace.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const DEFAULT_DEV_MODEL = 'qwen/qwen3.6-27b';
const DEFAULT_REVIEW_MODEL = 'openai/gpt-oss-120b';
const MAX_TASK_CHARS = 6_000;
const MAX_REVIEW_DIFF_CHARS = 160_000;

const toolDefinitions = [
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List all files in the virtual workspace.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read one UTF-8 text file from the virtual workspace.',
      parameters: {
        type: 'object', required: ['path'], additionalProperties: false,
        properties: { path: { type: 'string', minLength: 1, maxLength: 180 } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for a literal text fragment across workspace files.',
      parameters: {
        type: 'object', required: ['query'], additionalProperties: false,
        properties: { query: { type: 'string', minLength: 1, maxLength: 120 } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or replace a UTF-8 text file inside the virtual workspace.',
      parameters: {
        type: 'object', required: ['path', 'content'], additionalProperties: false,
        properties: {
          path: { type: 'string', minLength: 1, maxLength: 180 },
          content: { type: 'string', maxLength: 80000 },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_file',
      description: 'Delete a file inside the virtual workspace. Use only when required by the task.',
      parameters: {
        type: 'object', required: ['path'], additionalProperties: false,
        properties: { path: { type: 'string', minLength: 1, maxLength: 180 } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_quality_checks',
      description: 'Run deterministic safety and quality checks over the current virtual workspace.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_diff',
      description: 'Get the current unified-style diff against the workspace state at the beginning of this run.',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  },
  {
    type: 'function',
    function: {
      name: 'finish_task',
      description: 'Finish implementation after inspecting the diff and quality checks. Provide a concise factual summary.',
      parameters: {
        type: 'object', required: ['summary'], additionalProperties: false,
        properties: { summary: { type: 'string', minLength: 1, maxLength: 2500 } },
      },
    },
  },
];

async function loadPrompt(name) {
  return fs.readFile(path.join(rootDir, 'prompts', name), 'utf8');
}

async function groqChat({ apiKey, model, messages, tools, responseFormat, temperature = 0.2 }) {
  const body = { model, messages, temperature };
  if (tools) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  if (responseFormat) body.response_format = responseFormat;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });

  const raw = await response.text();
  let json;
  try { json = JSON.parse(raw); } catch { json = null; }
  if (!response.ok) {
    const safeMessage = json?.error?.message;
    throw new Error(response.status === 401 ? 'Groq rejected the API key.' : safeMessage ? `Groq request failed: ${String(safeMessage).slice(0, 240)}` : `Groq request failed (${response.status}).`);
  }
  if (!json?.choices?.[0]?.message) throw new Error('Groq returned an invalid response.');
  return { message: json.choices[0].message, usage: json.usage ?? null };
}

function parseToolArguments(toolCall) {
  try {
    const value = JSON.parse(toolCall.function.arguments || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error(`Invalid arguments for tool ${toolCall.function.name}`);
  }
}

function executeTool(workspace, name, args) {
  switch (name) {
    case 'list_files': return workspace.listFiles();
    case 'read_file': return workspace.readFile(args.path);
    case 'search_files': return workspace.search(args.query);
    case 'write_file': return workspace.writeFile(args.path, args.content);
    case 'delete_file': return workspace.deleteFile(args.path);
    case 'run_quality_checks': return workspace.qualityReport();
    case 'get_diff': return workspace.diff();
    case 'finish_task': return { accepted: true, summary: args.summary };
    default: throw new Error(`Tool not allowed: ${name}`);
  }
}

function safeToolEvent(name, args, result, error) {
  const base = { tool: name };
  if (name === 'read_file') return { ...base, path: args.path, outcome: error ? 'error' : 'read' };
  if (name === 'write_file') return { ...base, path: args.path, outcome: error ? 'error' : result.operation, bytes: result.bytes };
  if (name === 'delete_file') return { ...base, path: args.path, outcome: error ? 'error' : 'deleted' };
  if (name === 'search_files') return { ...base, query: args.query, matches: Array.isArray(result) ? result.length : 0, outcome: error ? 'error' : 'searched' };
  if (name === 'list_files') return { ...base, files: Array.isArray(result) ? result.length : 0, outcome: error ? 'error' : 'listed' };
  if (name === 'run_quality_checks') return { ...base, findings: result?.findings?.length ?? 0, outcome: error ? 'error' : 'checked' };
  if (name === 'get_diff') return { ...base, changed: Boolean(result), outcome: error ? 'error' : 'inspected' };
  if (name === 'finish_task') return { ...base, outcome: error ? 'error' : 'finished' };
  return { ...base, outcome: error ? 'error' : 'done' };
}

export async function runDevAgent({ apiKey, task, workspace, reviewFeedback = null, emit = () => {}, model = process.env.DEV_MODEL || DEFAULT_DEV_MODEL, maxTurns = Number(process.env.MAX_DEV_TURNS || 18) }) {
  if (typeof task !== 'string' || !task.trim() || task.length > MAX_TASK_CHARS) throw new Error('Task must be between 1 and 6000 characters.');
  const [identity, policy, role] = await Promise.all([
    loadPrompt('identity.md'), loadPrompt('engineering-policy.md'), loadPrompt('dev-agent.md'),
  ]);
  const system = `${identity}\n\n${policy}\n\n${role}`;
  const user = reviewFeedback
    ? `ORIGINAL TASK:\n${task.trim()}\n\nREVIEWER REQUESTED CHANGES:\n${reviewFeedback}\n\nInspect the current workspace, correct only verified findings, rerun quality checks, inspect the diff, then finish.`
    : `TASK:\n${task.trim()}\n\nInspect the repository instructions and relevant files first. Implement the task in the virtual workspace, run quality checks, inspect the diff, then finish.`;
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  let summary = '';

  emit({ type: 'agent_start', agent: 'dev', model });
  for (let turn = 1; turn <= Math.max(1, Math.min(maxTurns, 30)); turn++) {
    const response = await groqChat({ apiKey, model, messages, tools: toolDefinitions, temperature: 0.15 });
    if (response.usage) {
      for (const key of Object.keys(usage)) usage[key] += Number(response.usage[key] || 0);
    }
    const msg = response.message;
    const assistantMessage = { role: 'assistant', content: msg.content ?? null };
    if (msg.tool_calls) assistantMessage.tool_calls = msg.tool_calls;
    messages.push(assistantMessage);

    if (!msg.tool_calls?.length) {
      summary = String(msg.content || 'Implementation finished without a final summary.').slice(0, 2500);
      emit({ type: 'agent_finish', agent: 'dev', summary, turn });
      return { summary, usage, turns: turn };
    }

    for (const toolCall of msg.tool_calls) {
      const name = toolCall.function?.name;
      const args = parseToolArguments(toolCall);
      emit({ type: 'tool_start', agent: 'dev', tool: name, turn });
      let result;
      let error = null;
      try {
        result = executeTool(workspace, name, args);
      } catch (err) {
        error = err instanceof Error ? err.message : 'Tool failed';
        result = { error };
      }
      emit({ type: 'tool_finish', agent: 'dev', ...safeToolEvent(name, args, result, error), turn });
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        name,
        content: JSON.stringify(result),
      });
      if (name === 'finish_task' && !error) {
        summary = String(args.summary || '').slice(0, 2500);
        emit({ type: 'agent_finish', agent: 'dev', summary, turn });
        return { summary, usage, turns: turn };
      }
    }
  }
  throw new Error('DevAgent reached the maximum tool-turn limit before finishing.');
}

function normalizeReview(parsed) {
  const verdict = parsed?.verdict === 'approve' ? 'approve' : 'changes_requested';
  const score = Math.max(0, Math.min(100, Number(parsed?.score) || 0));
  const summary = typeof parsed?.summary === 'string' ? parsed.summary.slice(0, 2000) : 'Review completed.';
  const findings = Array.isArray(parsed?.findings) ? parsed.findings.slice(0, 12).map(item => ({
    severity: ['critical', 'high', 'medium', 'low'].includes(item?.severity) ? item.severity : 'medium',
    title: String(item?.title || 'Finding').slice(0, 180),
    detail: String(item?.detail || '').slice(0, 1200),
    file: item?.file ? String(item.file).slice(0, 180) : null,
  })) : [];
  if (verdict === 'approve' && findings.some(item => ['critical', 'high'].includes(item.severity))) {
    return { verdict: 'changes_requested', score, summary, findings };
  }
  return { verdict, score, summary, findings };
}

export async function runReviewerAgent({ apiKey, task, workspace, quality, emit = () => {}, model = process.env.REVIEW_MODEL || DEFAULT_REVIEW_MODEL }) {
  const [identity, role] = await Promise.all([loadPrompt('identity.md'), loadPrompt('reviewer-agent.md')]);
  const diff = workspace.diff().slice(0, MAX_REVIEW_DIFF_CHARS);
  const changedFiles = workspace.operations.map(item => item.path);
  const user = `ORIGINAL TASK:\n${task.trim()}\n\nCHANGED FILES:\n${[...new Set(changedFiles)].join('\n') || '(none)'}\n\nQUALITY REPORT:\n${JSON.stringify(quality, null, 2)}\n\nDIFF:\n${diff || '(no changes)'}\n\nReturn JSON only with this shape:\n{\n  "verdict": "approve" | "changes_requested",\n  "score": 0-100,\n  "summary": "concise review summary",\n  "findings": [{"severity":"critical|high|medium|low","title":"...","detail":"...","file":"optional path"}]\n}`;
  emit({ type: 'agent_start', agent: 'reviewer', model });
  const response = await groqChat({
    apiKey,
    model,
    messages: [{ role: 'system', content: `${identity}\n\n${role}` }, { role: 'user', content: user }],
    responseFormat: { type: 'json_object' },
    temperature: 0.05,
  });
  let parsed;
  try { parsed = JSON.parse(response.message.content || '{}'); } catch { throw new Error('ReviewerAgent returned invalid JSON.'); }
  const review = normalizeReview(parsed);
  emit({ type: 'agent_finish', agent: 'reviewer', verdict: review.verdict, score: review.score, findings: review.findings.length, summary: review.summary });
  return { ...review, usage: response.usage ?? null };
}

function reviewFeedbackText(review) {
  return review.findings.map((item, index) => `${index + 1}. [${item.severity.toUpperCase()}] ${item.title}${item.file ? ` (${item.file})` : ''}: ${item.detail}`).join('\n');
}

export async function runAgentPair({ apiKey, task, seed, emit = () => {} }) {
  if (!apiKey) throw new Error('GROQ_API_KEY is not configured on the server.');
  const workspace = new VirtualWorkspace(seed);
  const cycles = Math.max(1, Math.min(Number(process.env.MAX_REVIEW_CYCLES || 2), 3));
  const history = [];

  let dev = await runDevAgent({ apiKey, task, workspace, emit });
  for (let cycle = 1; cycle <= cycles; cycle++) {
    const quality = workspace.qualityReport();
    const review = await runReviewerAgent({ apiKey, task, workspace, quality, emit });
    history.push({ cycle, dev, review, quality });
    if (review.verdict === 'approve') {
      return {
        status: 'approved',
        task,
        files: workspace.snapshot(),
        diff: workspace.diff(),
        quality,
        history,
        operations: workspace.operations,
      };
    }
    if (cycle === cycles) {
      return {
        status: 'changes_requested',
        task,
        files: workspace.snapshot(),
        diff: workspace.diff(),
        quality,
        history,
        operations: workspace.operations,
      };
    }
    emit({ type: 'cycle', cycle: cycle + 1, message: 'Reviewer requested changes; sending findings back to DevAgent.' });
    dev = await runDevAgent({ apiKey, task, workspace, reviewFeedback: reviewFeedbackText(review), emit });
  }
}

export const agentInternals = { normalizeReview, executeTool, parseToolArguments };
