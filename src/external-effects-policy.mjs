export const EXTERNAL_EFFECTS_POLICY = `NON-NEGOTIABLE PRODUCT TRUTHFULNESS POLICY:
- Never claim that an external side effect succeeded unless the repository contains a real reachable capability that can perform and verify that effect.
- External effects include synchronization, server persistence, sending messages/email, uploads, publishing, payments, deployments, third-party mutations, and similar operations.
- If the task explicitly says the required API/backend/integration does not exist, do NOT simulate success with timers, local state, mocks, optimistic labels, or fake responses.
- A truthful UI may explain that the capability is unavailable, keep the action disabled/unavailable, or implement only a clearly local action that does not imply an external effect occurred.
- A Reviewer must treat simulated or fabricated external success as a HIGH-severity correctness/product-integrity defect and request changes.`;

const ABSENT_CAPABILITY = /(?:\b(?:no|without)\b[^\n]{0,80}\b(?:api|backend|server|endpoint|integration|service)\b|\b(?:n[aã]o existe|sem)\b[^\n]{0,80}\b(?:api|backend|servidor|endpoint|integra[cç][aã]o|servi[cç]o)\b)/i;
const EXTERNAL_EFFECT = /\b(sync|synchroni[sz]|sincroniz|upload|publish|publicar|send|enviar|email|message|mensagem|payment|pagamento|deploy|persist|salvar no servidor|save to server)\w*/i;
const SUCCESS_CLAIM = /\b(success|successful|succeeded|completed|synced|uploaded|published|sent|saved|sucesso|sincronizad[oa]s?|conclu[ií]d[oa]s?|enviad[oa]s?|publicad[oa]s?|salv[oa]s?)\b/i;
const SIMULATION_SIGNAL = /\b(setTimeout|mock|simulate|simulat|simulad|fake|useState)\b/i;
const REAL_IO_SIGNAL = /(?:\bfetch\s*\(|\baxios\b|XMLHttpRequest|WebSocket|\bsupabase\b|\bfirebase\b|\bgraphql\b|\/api\/|https?:\/\/)/i;

export function taskWithExternalEffectsPolicy(task) {
  return `${EXTERNAL_EFFECTS_POLICY}\n\nORIGINAL USER TASK:\n${String(task || '').trim()}`;
}

export function detectFabricatedExternalSuccess({ task, diff }) {
  const taskText = String(task || '');
  const diffText = String(diff || '');
  if (!ABSENT_CAPABILITY.test(taskText)) return null;
  if (!EXTERNAL_EFFECT.test(`${taskText}\n${diffText}`)) return null;
  if (!SUCCESS_CLAIM.test(diffText)) return null;
  if (!SIMULATION_SIGNAL.test(diffText)) return null;
  if (REAL_IO_SIGNAL.test(diffText)) return null;

  return {
    severity: 'high',
    title: 'Fabricated external success state',
    detail: 'The task states that the required external capability is unavailable, but the implementation simulates a successful external effect using client-side behavior. The UI must not claim synchronization, upload, send, publish, payment, persistence, or similar success without a real reachable capability.',
    file: null,
  };
}

export function enforceExternalEffectsTruthfulness(result, originalTask) {
  if (!result || typeof result !== 'object') return result;
  const finding = detectFabricatedExternalSuccess({ task: originalTask, diff: result.diff });
  if (!finding) {
    result.task = originalTask;
    return result;
  }

  const quality = result.quality && typeof result.quality === 'object'
    ? result.quality
    : { ok: true, findings: [] };
  quality.findings = Array.isArray(quality.findings) ? quality.findings : [];
  quality.findings.push({ severity: 'error', file: null, message: finding.title });
  quality.ok = false;
  result.quality = quality;

  const history = Array.isArray(result.history) ? result.history : [];
  if (history.length) {
    const last = history[history.length - 1];
    const review = last.review && typeof last.review === 'object' ? last.review : {};
    review.verdict = 'changes_requested';
    review.score = Math.min(Number(review.score) || 0, 60);
    review.findings = Array.isArray(review.findings) ? review.findings : [];
    review.findings.push(finding);
    review.summary = 'Rejected by the product-truthfulness gate: the implementation simulates success for an external capability that the task says does not exist.';
    last.review = review;
  }

  result.status = 'changes_requested';
  result.task = originalTask;
  return result;
}
