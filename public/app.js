const $ = id => document.getElementById(id);

const presets = {
  visual: 'Redesenhe este dashboard para parecer um produto moderno, calmo e profissional. Use uma base off-white, teal profundo como cor primária, estados semânticos discretos, cards com menos bordas e uma hierarquia de ações clara. Garanta responsividade até 320px, foco visível e sem novas dependências. Não invente funcionalidade de backend.',
  a11y: 'Revise a UI para acessibilidade e responsividade. Garanta landmarks claros, foco visível, estados que não dependam apenas de cor, touch targets adequados, leitura confortável em 320px e suporte a prefers-reduced-motion. Preserve o visual e não adicione dependências.',
  states: 'Melhore a lista de tarefas para comunicar estados pending e done de forma semântica e acessível. Crie uma hierarquia visual clara, sem usar preto como acento principal e sem inventar ações de backend. Mantenha a UI responsiva até 320px.',
};

const state = {
  config: null,
  starterFiles: {},
  currentFiles: {},
  selectedFile: null,
  diff: '',
  running: false,
  timeline: [],
  result: null,
};

await init();

async function init() {
  wireEvents();
  try {
    const [configResponse, starterResponse] = await Promise.all([fetch('/api/config'), fetch('/api/starter')]);
    if (!configResponse.ok || !starterResponse.ok) throw new Error('Falha ao carregar configuração.');
    state.config = await configResponse.json();
    const starter = await starterResponse.json();
    state.starterFiles = starter.files;
    state.currentFiles = structuredClone(starter.files);
    renderConfig();
    renderFiles();
  } catch (error) {
    toast('Não foi possível inicializar o laboratório.');
    $('connectionStatus').className = 'topbar-status missing';
    $('connectionStatus').innerHTML = '<span class="status-dot"></span><span>Servidor indisponível</span>';
  }
}

function wireEvents() {
  document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
    $('taskInput').value = presets[button.dataset.preset];
    $('taskInput').focus();
  }));
  $('runButton').addEventListener('click', runAgents);
  $('resetButton').addEventListener('click', resetWorkspace);
  $('clearTimeline').addEventListener('click', () => {
    state.timeline = [];
    renderTimeline();
  });
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => switchCodeView(button.dataset.view)));
}

function renderConfig() {
  $('devModel').textContent = state.config.devModel;
  $('reviewModel').textContent = state.config.reviewModel;
  const status = $('connectionStatus');
  if (state.config.groqConfigured) {
    status.className = 'topbar-status ready';
    status.innerHTML = '<span class="status-dot"></span><span>Groq pronto</span>';
  } else {
    status.className = 'topbar-status missing';
    status.innerHTML = '<span class="status-dot"></span><span>Configure GROQ_API_KEY</span>';
  }
}

async function runAgents() {
  if (state.running) return;
  const task = $('taskInput').value.trim();
  if (!task) return toast('Escreva uma tarefa primeiro.');
  if (!state.config?.groqConfigured) return toast('Configure GROQ_API_KEY no servidor antes de executar.');

  state.running = true;
  state.result = null;
  state.diff = '';
  state.timeline = [];
  resetReviewPanel();
  setRunningUi(true);

  const files = $('continueWorkspace').checked ? state.currentFiles : state.starterFiles;
  try {
    const response = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task, files }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `Falha HTTP ${response.status}`);
    }
    if (!response.body) throw new Error('Resposta sem stream.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        handleEvent(JSON.parse(line));
      }
    }
    if (buffer.trim()) handleEvent(JSON.parse(buffer));
  } catch (error) {
    handleEvent({ type: 'error', message: error instanceof Error ? error.message : 'Execução falhou.' });
  } finally {
    state.running = false;
    setRunningUi(false);
  }
}

function handleEvent(event) {
  const now = new Date();
  if (event.type === 'run_start') {
    addTimeline('system', 'Run iniciado', 'Workspace preparado e limites de segurança aplicados.', now);
    return;
  }
  if (event.type === 'agent_start') {
    setAgentState(event.agent, 'running');
    addTimeline(event.agent, `${labelAgent(event.agent)} iniciou`, event.model || '', now);
    return;
  }
  if (event.type === 'tool_start') return;
  if (event.type === 'tool_finish') {
    addTimeline(event.agent, toolTitle(event), toolDetail(event), now);
    return;
  }
  if (event.type === 'agent_finish') {
    setAgentState(event.agent, 'done');
    if (event.agent === 'reviewer') {
      $('reviewScore').textContent = String(event.score ?? '—');
      $('reviewVerdict').textContent = event.verdict === 'approve' ? 'aprovado' : 'mudanças pedidas';
      $('reviewVerdict').className = `badge ${event.verdict === 'approve' ? '' : 'muted'}`;
    }
    addTimeline(event.agent, `${labelAgent(event.agent)} concluiu`, event.summary || `${event.findings || 0} finding(s)`, now);
    return;
  }
  if (event.type === 'cycle') {
    addTimeline('system', `Ciclo ${event.cycle}`, event.message, now);
    return;
  }
  if (event.type === 'error') {
    $('resultPill').className = 'result-pill changes';
    $('resultPill').textContent = 'Execução falhou';
    addTimeline('error', 'Erro seguro', event.message, now);
    toast(event.message);
    return;
  }
  if (event.type === 'result') {
    applyResult(event.result);
  }
}

function applyResult(result) {
  state.result = result;
  state.currentFiles = result.files;
  state.diff = result.diff || '';
  const last = result.history?.at(-1);
  const review = last?.review;
  $('reviewScore').textContent = review ? String(review.score) : '—';
  $('changedFiles').textContent = String(new Set((result.operations || []).map(item => item.path)).size);
  $('qualityFindings').textContent = String(result.quality?.findings?.length ?? 0);
  $('reviewCycles').textContent = String(result.history?.length ?? 0);
  $('resultPill').className = `result-pill ${result.status === 'approved' ? 'approved' : 'changes'}`;
  $('resultPill').textContent = result.status === 'approved' ? 'Reviewer aprovou' : 'Mudanças ainda necessárias';
  renderReview(review);
  renderFiles();
  $('diffContent').textContent = state.diff || 'Nenhuma alteração.';
  addTimeline('system', 'Resultado consolidado', result.status === 'approved' ? 'O ReviewerAgent aprovou o estado final.' : 'O limite de ciclos terminou com findings pendentes.', new Date());
}

function renderReview(review) {
  if (!review) return resetReviewPanel();
  $('reviewVerdict').textContent = review.verdict === 'approve' ? 'aprovado' : 'mudanças pedidas';
  $('reviewVerdict').className = `badge ${review.verdict === 'approve' ? '' : 'muted'}`;
  $('reviewSummary').textContent = review.summary || 'Revisão concluída.';
  const root = $('reviewFindings');
  root.textContent = '';
  if (!review.findings?.length) {
    const empty = document.createElement('div');
    empty.className = 'finding';
    empty.innerHTML = '<div class="finding-header"><strong>Sem findings materiais</strong><em>ok</em></div><p>O ReviewerAgent não identificou bloqueadores concretos nesta rodada.</p>';
    root.appendChild(empty);
    return;
  }
  for (const finding of review.findings) {
    const item = document.createElement('article');
    item.className = `finding ${finding.severity}`;
    const header = document.createElement('div');
    header.className = 'finding-header';
    const title = document.createElement('strong');
    title.textContent = finding.title;
    const severity = document.createElement('em');
    severity.textContent = finding.severity;
    header.append(title, severity);
    const detail = document.createElement('p');
    detail.textContent = finding.detail;
    item.append(header, detail);
    if (finding.file) {
      const file = document.createElement('code');
      file.textContent = finding.file;
      item.appendChild(file);
    }
    root.appendChild(item);
  }
}

function resetReviewPanel() {
  $('reviewScore').textContent = '—';
  $('changedFiles').textContent = '0';
  $('qualityFindings').textContent = '—';
  $('reviewCycles').textContent = '0';
  $('reviewVerdict').textContent = 'sem review';
  $('reviewVerdict').className = 'badge muted';
  $('reviewSummary').textContent = 'O ReviewerAgent ainda não analisou nenhuma alteração.';
  $('reviewFindings').textContent = '';
}

function renderFiles() {
  const files = Object.keys(state.currentFiles).sort();
  if (!files.length) return;
  if (!state.selectedFile || !(state.selectedFile in state.currentFiles)) state.selectedFile = files[0];
  const root = $('fileList');
  root.textContent = '';
  for (const file of files) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `file-button ${file === state.selectedFile ? 'active' : ''}`;
    button.textContent = file;
    button.title = file;
    button.addEventListener('click', () => {
      state.selectedFile = file;
      renderFiles();
    });
    root.appendChild(button);
  }
  $('fileContent').textContent = state.currentFiles[state.selectedFile] || '';
}

function resetWorkspace() {
  if (state.running) return;
  state.currentFiles = structuredClone(state.starterFiles);
  state.selectedFile = null;
  state.diff = '';
  state.result = null;
  state.timeline = [];
  $('continueWorkspace').checked = false;
  $('diffContent').textContent = 'Nenhuma alteração ainda.';
  $('resultPill').className = 'result-pill idle';
  $('resultPill').textContent = 'Aguardando tarefa';
  resetReviewPanel();
  renderTimeline();
  renderFiles();
  toast('Sandbox resetado.');
}

function switchCodeView(view) {
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
  });
  $('filesView').classList.toggle('hidden', view !== 'files');
  $('diffView').classList.toggle('hidden', view !== 'diff');
}

function setRunningUi(running) {
  $('runButton').disabled = running;
  $('resetButton').disabled = running;
  $('runButton').textContent = running ? 'Agentes trabalhando…' : 'Executar agentes';
  if (running) {
    $('resultPill').className = 'result-pill running';
    $('resultPill').textContent = 'Executando';
    setAgentState('dev', 'running');
    setAgentState('reviewer', 'ready');
  }
}

function setAgentState(agent, value) {
  const el = agent === 'dev' ? $('devState') : $('reviewState');
  el.className = `agent-state ${value === 'running' ? 'running' : value === 'done' ? 'done' : ''}`;
  el.textContent = value === 'running' ? 'trabalhando' : value === 'done' ? 'concluído' : 'pronto';
}

function addTimeline(agent, title, detail, time = new Date()) {
  state.timeline.push({ agent, title, detail, time: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) });
  if (state.timeline.length > 80) state.timeline.shift();
  renderTimeline();
}

function renderTimeline() {
  const root = $('timeline');
  root.textContent = '';
  if (!state.timeline.length) {
    root.innerHTML = '<div class="empty-state"><span>◎</span><p>As ações dos agentes aparecem aqui sem expor raciocínio privado.</p></div>';
    return;
  }
  for (const event of state.timeline) {
    const item = document.createElement('article');
    item.className = 'timeline-item';
    const icon = document.createElement('div');
    icon.className = 'timeline-icon';
    icon.textContent = event.agent === 'dev' ? 'D' : event.agent === 'reviewer' ? 'R' : event.agent === 'error' ? '!' : '•';
    const copy = document.createElement('div');
    copy.className = 'timeline-copy';
    const strong = document.createElement('strong');
    strong.textContent = event.title;
    const span = document.createElement('span');
    span.textContent = event.detail || '';
    copy.append(strong, span);
    const time = document.createElement('time');
    time.className = 'timeline-time';
    time.textContent = event.time;
    item.append(icon, copy, time);
    root.appendChild(item);
  }
  root.scrollTop = root.scrollHeight;
}

function toolTitle(event) {
  const names = {
    list_files: 'Listou arquivos', read_file: 'Leu arquivo', search_files: 'Pesquisou código', write_file: 'Alterou arquivo', delete_file: 'Removeu arquivo', run_quality_checks: 'Executou quality checks', get_diff: 'Inspecionou diff', finish_task: 'Finalizou implementação',
  };
  return names[event.tool] || event.tool;
}

function toolDetail(event) {
  if (event.path) return event.path;
  if (event.query) return `“${event.query}” · ${event.matches ?? 0} resultado(s)`;
  if (event.tool === 'run_quality_checks') return `${event.findings ?? 0} finding(s) determinísticos`;
  if (event.tool === 'list_files') return `${event.files ?? 0} arquivo(s)`;
  if (event.tool === 'get_diff') return event.changed ? 'Há alterações para revisar.' : 'Nenhuma alteração.';
  return event.outcome || '';
}

function labelAgent(agent) {
  return agent === 'dev' ? 'DevAgent' : 'ReviewerAgent';
}

let toastTimer;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}
