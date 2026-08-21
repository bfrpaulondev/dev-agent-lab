const $ = id => document.getElementById(id);

const presets = {
  visual: 'Melhore a interface do projeto com hierarquia visual mais clara, responsividade até 320px e foco visível. Preserve a arquitetura e não adicione dependências sem necessidade.',
  a11y: 'Revise a interface para acessibilidade: teclado, foco visível, landmarks, labels, contraste e responsividade. Corrija apenas problemas verificáveis e preserve o comportamento existente.',
  security: 'Revise a implementação relacionada a esta tarefa buscando riscos concretos de segurança, validação de input, XSS, exposição de secrets e estados falsos de sucesso. Corrija apenas problemas verificáveis.',
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
  proposalToken: null,
  pr: null,
  accessKey: '',
  githubReposLoaded: false,
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
    populateProjects();
    renderConfig();
    renderMode();
    renderFiles();
  } catch {
    toast('Não foi possível inicializar o ForgePair.');
    const status = $('connectionStatus');
    status.className = 'topbar-status missing';
    status.innerHTML = '<span class="status-dot"></span><span>Servidor indisponível</span>';
  }
}

function wireEvents() {
  document.querySelectorAll('[data-preset]').forEach(button => button.addEventListener('click', () => {
    $('taskInput').value = presets[button.dataset.preset];
    $('taskInput').focus();
  }));
  $('projectSelect').addEventListener('change', () => {
    resetRunState(false);
    renderMode();
  });
  $('unlockButton').addEventListener('click', unlockGitHub);
  $('accessInput').addEventListener('keydown', event => {
    if (event.key === 'Enter') unlockGitHub();
  });
  $('runButton').addEventListener('click', runAgents);
  $('resetButton').addEventListener('click', () => resetRunState(true));
  $('openPrButton').addEventListener('click', openPullRequest);
  $('clearTimeline').addEventListener('click', () => {
    state.timeline = [];
    renderTimeline();
  });
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => switchCodeView(button.dataset.view)));
}

function populateProjects(repos = []) {
  const select = $('projectSelect');
  for (const option of [...select.options]) {
    if (option.value !== 'sandbox') option.remove();
  }
  for (const repo of repos) {
    const option = document.createElement('option');
    option.value = `github:${repo}`;
    option.textContent = repo;
    select.appendChild(option);
  }
}

function authHeaders() {
  return state.accessKey ? { 'X-ForgePair-Access': state.accessKey } : {};
}

async function unlockGitHub() {
  if (!state.config?.accessConfigured) return toast('Configure FORGEPAIR_ACCESS_KEY no Netlify primeiro.');
  const key = $('accessInput').value;
  if (!key) return toast('Digite a chave do operador.');
  $('unlockButton').disabled = true;
  $('unlockButton').textContent = 'Verificando…';
  try {
    const response = await fetch('/api/github/repos', { headers: { 'X-ForgePair-Access': key } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Falha HTTP ${response.status}`);
    state.accessKey = key;
    state.githubReposLoaded = true;
    $('accessInput').value = '';
    populateProjects(payload.repos || []);
    $('unlockStatus').textContent = `${payload.repos?.length || 0} repositório(s) autorizado(s). Chave mantida apenas nesta sessão.`;
    $('unlockPanel').classList.add('unlocked');
    renderConfig();
    renderMode();
    toast('ForgePair desbloqueado.');
  } catch (error) {
    state.accessKey = '';
    state.githubReposLoaded = false;
    populateProjects();
    $('unlockStatus').textContent = error instanceof Error ? error.message : 'Acesso rejeitado.';
    toast(error instanceof Error ? error.message : 'Acesso rejeitado.');
  } finally {
    $('unlockButton').disabled = false;
    $('unlockButton').textContent = 'Desbloquear';
  }
}

function selectedRepo() {
  const value = $('projectSelect').value;
  return value.startsWith('github:') ? value.slice(7) : null;
}

function renderConfig() {
  $('devModel').textContent = state.config.devModel;
  $('reviewModel').textContent = state.config.reviewModel;
  const status = $('connectionStatus');
  if (state.config.groqConfigured && state.config.githubConfigured && state.githubReposLoaded) {
    status.className = 'topbar-status ready';
    status.innerHTML = '<span class="status-dot"></span><span>Groq + GitHub desbloqueados</span>';
  } else if (state.config.groqConfigured && state.config.githubConfigured) {
    status.className = 'topbar-status ready';
    status.innerHTML = '<span class="status-dot"></span><span>Serviços prontos · acesso bloqueado</span>';
  } else if (state.config.groqConfigured && !state.config.accessConfigured) {
    status.className = 'topbar-status missing';
    status.innerHTML = '<span class="status-dot"></span><span>Configure FORGEPAIR_ACCESS_KEY</span>';
  } else if (state.config.groqConfigured) {
    status.className = 'topbar-status ready';
    status.innerHTML = '<span class="status-dot"></span><span>Groq pronto · GitHub incompleto</span>';
  } else {
    status.className = 'topbar-status missing';
    status.innerHTML = '<span class="status-dot"></span><span>Configure GROQ_API_KEY</span>';
  }
  $('unlockPanel').classList.toggle('hidden', !state.config.accessConfigured);
}

function renderMode() {
  const repo = selectedRepo();
  $('continueRow').classList.toggle('hidden', Boolean(repo));
  $('workspaceMode').textContent = repo ? 'GitHub controlado' : 'Sandbox local';
  $('repoLabel').textContent = repo || 'Virtual repository';
  $('workspaceContext').textContent = repo
    ? `${repo} · default branch lida no servidor · PR somente em agent/...`
    : 'Workspace virtual sem escrita externa.';
  $('projectHelp').textContent = repo
    ? 'O servidor lê uma snapshot limitada do repo. O browser nunca recebe o token GitHub.'
    : state.githubReposLoaded
      ? 'Escolha um repositório autorizado para trabalhar com código real ou mantenha o sandbox.'
      : state.config?.githubConfigured
        ? 'Desbloqueie o acesso do operador para carregar os repositórios autorizados.'
        : 'GitHub ainda não está configurado no servidor; o sandbox continua disponível.';
  $('safetyCopy').textContent = repo
    ? 'GitHub: sem escrita em main, merge, deploy, workflows, infra ou secrets.'
    : 'Sandbox: sem shell, GitHub write, merge, deploy ou secrets.';
}

async function runAgents() {
  if (state.running) return;
  const task = $('taskInput').value.trim();
  if (!task) return toast('Escreva uma tarefa primeiro.');
  if (!state.config?.groqConfigured) return toast('Configure GROQ_API_KEY antes de executar.');
  if (state.config?.accessConfigured && !state.accessKey) return toast('Desbloqueie o ForgePair com a chave do operador.');

  const repo = selectedRepo();
  if (repo && !state.config?.githubConfigured) return toast('Configure o modo GitHub no servidor primeiro.');

  state.running = true;
  state.result = null;
  state.proposalToken = null;
  state.pr = null;
  state.diff = '';
  state.timeline = [];
  resetReviewPanel();
  renderPrAction();
  setRunningUi(true);

  try {
    const endpoint = repo ? '/api/github/run' : '/api/run';
    const payload = repo
      ? { task, repo }
      : { task, files: $('continueWorkspace').checked ? state.currentFiles : state.starterFiles };
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload.error || `Falha HTTP ${response.status}`);
    }
    await consumeNdjson(response);
  } catch (error) {
    handleEvent({ type: 'error', message: error instanceof Error ? error.message : 'Execução falhou.' });
  } finally {
    state.running = false;
    setRunningUi(false);
  }
}

async function consumeNdjson(response) {
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
      if (line.trim()) handleEvent(JSON.parse(line));
    }
  }
  if (buffer.trim()) handleEvent(JSON.parse(buffer));
}

function handleEvent(event) {
  const eventTime = event.at || event.startedAt ? new Date(event.at || event.startedAt) : new Date();
  if (event.type === 'run_start') {
    const detail = event.mode === 'github-controlled'
      ? `${event.repo}@${event.baseBranch} · ${event.snapshotFiles || 0} arquivo(s) selecionados`
      : 'Workspace preparado e limites de segurança aplicados.';
    addTimeline('system', 'Analisando projeto', detail, eventTime);
    return;
  }
  if (event.type === 'agent_start') {
    setAgentState(event.agent, 'running');
    addTimeline(event.agent, `${labelAgent(event.agent)} iniciou`, event.model || '', eventTime);
    return;
  }
  if (event.type === 'tool_start') return;
  if (event.type === 'tool_finish') {
    addTimeline(event.agent, toolTitle(event), toolDetail(event), eventTime);
    return;
  }
  if (event.type === 'agent_finish') {
    setAgentState(event.agent, 'done');
    if (event.agent === 'reviewer') {
      $('reviewScore').textContent = String(event.score ?? '—');
      $('reviewVerdict').textContent = event.verdict === 'approve' ? 'aprovado' : 'mudanças pedidas';
      $('reviewVerdict').className = `badge ${event.verdict === 'approve' ? '' : 'muted'}`;
    }
    addTimeline(event.agent, `${labelAgent(event.agent)} concluiu`, event.summary || `${event.findings || 0} finding(s)`, eventTime);
    return;
  }
  if (event.type === 'cycle') {
    addTimeline('system', `Ciclo ${event.cycle}`, event.message, eventTime);
    return;
  }
  if (event.type === 'error') {
    $('resultPill').className = 'result-pill changes';
    $('resultPill').textContent = 'Execução falhou';
    addTimeline('error', 'Erro seguro', event.message, eventTime);
    toast(event.message);
    return;
  }
  if (event.type === 'result') applyResult(event.result);
}

function applyResult(result) {
  state.result = result;
  state.currentFiles = result.files || {};
  state.diff = result.diff || '';
  state.proposalToken = result.proposalToken || null;
  const last = result.history?.at(-1);
  const review = last?.review;
  $('reviewScore').textContent = review ? String(review.score) : '—';
  $('changedFiles').textContent = String(new Set((result.operations || []).map(item => item.path)).size);
  $('qualityFindings').textContent = String(result.quality?.findings?.length ?? 0);
  $('reviewCycles').textContent = String(result.history?.length ?? 0);
  $('resultPill').className = `result-pill ${result.status === 'approved' ? 'approved' : 'changes'}`;
  $('resultPill').textContent = result.status === 'approved' ? 'Pronto para revisão final' : 'Mudanças necessárias';
  renderReview(review);
  renderQuality(result.quality?.findings || []);
  renderFiles();
  $('diffContent').textContent = state.diff || 'Nenhuma alteração.';
  if (result.github) {
    $('workspaceContext').textContent = `${result.github.repo}@${result.github.baseBranch} · snapshot ${result.github.snapshotFiles} arquivo(s) · base ${String(result.github.baseSha).slice(0, 8)}`;
  }
  renderPrAction();
  addTimeline('system', 'Resultado consolidado',
    result.status === 'approved'
      ? state.proposalToken ? 'Gates aprovados. O PR pode ser criado manualmente.' : 'Reviewer aprovou o estado final.'
      : 'O run terminou com findings pendentes.',
    new Date());
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
  for (const finding of review.findings) root.appendChild(findingElement(finding));
}

function renderQuality(findings) {
  const root = $('qualityDetails');
  root.textContent = '';
  if (!findings.length) return;
  const heading = document.createElement('strong');
  heading.textContent = 'Quality determinístico';
  root.appendChild(heading);
  for (const finding of findings) {
    const line = document.createElement('p');
    line.textContent = `${finding.severity || 'info'} · ${finding.file || 'workspace'} · ${finding.message || finding.title || 'finding'}`;
    root.appendChild(line);
  }
}

function findingElement(finding) {
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
  return item;
}

async function openPullRequest() {
  if (!state.proposalToken || state.running) return;
  $('openPrButton').disabled = true;
  $('openPrButton').textContent = 'Abrindo PR…';
  try {
    const response = await fetch('/api/github/pr', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ proposalToken: state.proposalToken }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Falha HTTP ${response.status}`);
    state.pr = payload;
    state.proposalToken = null;
    addTimeline('system', `PR #${payload.number} criado`, `${payload.branch} · nenhum merge foi executado`, new Date());
    renderPrAction();
    toast(`PR #${payload.number} criado.`);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Falha ao abrir PR.');
    $('openPrButton').disabled = false;
    $('openPrButton').textContent = 'Abrir PR no GitHub';
  }
}

function renderPrAction() {
  const button = $('openPrButton');
  const result = $('prResult');
  button.classList.toggle('hidden', !state.proposalToken);
  button.disabled = !state.proposalToken;
  button.textContent = 'Abrir PR no GitHub';
  result.classList.toggle('hidden', !state.pr);
  result.textContent = '';
  if (state.pr) {
    const link = document.createElement('a');
    link.href = state.pr.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = `Abrir PR #${state.pr.number} · ${state.pr.branch}`;
    result.appendChild(link);
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
  $('qualityDetails').textContent = '';
}

function renderFiles() {
  const files = Object.keys(state.currentFiles).sort();
  const root = $('fileList');
  root.textContent = '';
  if (!files.length) {
    $('fileContent').textContent = '';
    return;
  }
  if (!state.selectedFile || !(state.selectedFile in state.currentFiles)) state.selectedFile = files[0];
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

function resetRunState(showToast) {
  if (state.running) return;
  state.currentFiles = structuredClone(state.starterFiles);
  state.selectedFile = null;
  state.diff = '';
  state.result = null;
  state.proposalToken = null;
  state.pr = null;
  state.timeline = [];
  $('continueWorkspace').checked = false;
  $('diffContent').textContent = 'Nenhuma alteração ainda.';
  $('resultPill').className = 'result-pill idle';
  $('resultPill').textContent = 'Aguardando tarefa';
  resetReviewPanel();
  renderTimeline();
  renderFiles();
  renderPrAction();
  renderMode();
  if (showToast) toast('Workspace resetado.');
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
  $('projectSelect').disabled = running;
  $('runButton').textContent = running ? 'Agentes trabalhando…' : 'Executar tarefa';
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
  state.timeline.push({
    agent,
    title,
    detail,
    time: time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
  });
  if (state.timeline.length > 80) state.timeline.shift();
  renderTimeline();
}

function renderTimeline() {
  const root = $('timeline');
  root.textContent = '';
  if (!state.timeline.length) {
    root.innerHTML = '<div class="empty-state"><span>◎</span><p>Analisando → Implementando → Quality checks → Reviewer → Pronto.</p></div>';
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
    list_files: 'Listou arquivos',
    read_file: 'Leu arquivo',
    search_files: 'Pesquisou código',
    write_file: 'Alterou arquivo',
    delete_file: 'Removeu arquivo',
    run_quality_checks: 'Executou quality checks',
    get_diff: 'Inspecionou diff',
    finish_task: 'Finalizou implementação',
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
  toastTimer = setTimeout(() => el.classList.remove('show'), 3800);
}
