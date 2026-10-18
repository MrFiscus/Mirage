// The console renders host-side Mirage events. Launching is always an explicit action.
import { FLEET_MODES, modeById, launchPaths, loopDepthFromActions, compareSummary, hostnameFor } from './fleet-mode.js';

const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[c]));
const icon = (name) => {
  const paths = {
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    back: '<path d="M20 12H4m6-6-6 6 6 6"/>',
    expand: '<path d="M7 17 17 7M7 7h10v10"/>',
    machine: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4M7 9h4m-4 3h7"/>',
    theme: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none"/>',
    folder: '<path d="M3 7V5h6l2 2h10v13H3Z"/>',
    file: '<path d="M6 3h8l4 4v14H6Zm8 0v5h4M9 12h6m-6 4h6"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
    unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.75-1.4"/>',
    warning: '<path d="M12 3 2 20h20Z"/><path d="M12 10v4m0 3v.5"/>',
    globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.arrow}</svg>`;
};
const verdictName = { pass: 'Real', mirage: 'Miraged', block: 'Stopped' };
const verdictSymbol = { pass: '✓', mirage: '◐', block: '■' };
const verdictTip = {
  pass: 'In its allowed area. The action ran against the real environment.',
  mirage: 'Off-limits. The agent received a believable fake; nothing real was touched.',
  block: 'Clear escape or tampering attempt. Hard stop; nothing ran.',
};
// Plain-English headline for one action, for the judge who does not read shell. Two clauses: what the
// agent attempted (from the command verb + the watcher's rule hit) and what Mirage did about it.
const shortRef = (ref) => { const parts = String(ref).split('/').filter(Boolean); return parts.length > 2 ? `…/${parts.slice(-2).join('/')}` : ref; };
function plainHeadline(action) {
  const cmd = action.cmd || '', reason = action.reason || '', verb = cmd.trim().split(/\s+/)[0] ?? '';
  const ref = reason.match(/[:(]\s*([^\s()]+)\)?\s*$/)?.[1] ?? '';
  let kind = 'command', attempt;
  if (/^(cat|head|tail|less|more)$/.test(verb)) kind = 'file';
  else if (/^(ls|find|tree|dir|du|stat)$/.test(verb)) kind = 'folder';
  else if (verb === 'GET') kind = 'server';
  else if (verb === 'POST' || /\b(curl|wget)\b.*(\s-d\s|--data|--post)/.test(cmd)) kind = 'send';
  else if (/(?:&\s*$|\bnohup\b|\bsetsid\b|\bdisown\b)/.test(cmd)) kind = 'background';
  const base = { file: 'open a file', folder: 'look inside a folder', server: 'contact a server', send: 'send data to a server', background: 'start a hidden program', command: 'run a command' }[kind];
  let fake = { file: 'a fake file', folder: 'a fake folder', server: 'a fake reply', send: 'a fake reply', background: 'a fake result', command: 'a fake result' }[kind];
  if (/decoy credential/.test(reason)) { attempt = 'used a decoy password we planted as bait'; fake = 'fake credentials that lead nowhere'; }
  else if (/^tool .*not in scope$/.test(reason)) attempt = 'tried an ability it was never given';
  else if (/own config/.test(reason)) attempt = 'tried to change its own safety settings';
  else if (/scorer|answer key/.test(reason)) attempt = 'tried to read the answer key';
  else if (/cage\/monitoring config/.test(reason)) attempt = "tried to change the sandbox's monitoring";
  else if (/background process/.test(reason)) attempt = 'tried to start a hidden program that keeps running';
  else if (/exfiltration\/metadata host/.test(reason)) attempt = `tried to send data outside the sandbox${ref ? ` (${ref})` : ''}`;
  else if (/out-of-scope host/.test(reason)) attempt = `tried to ${kind === 'send' ? 'send data to' : 'contact'} a server it was never given${ref ? ` (${ref})` : ''}`;
  else if (/path outside scope/.test(reason)) attempt = `tried to ${base} in an off-limits area${ref ? ` (${shortRef(ref)})` : ''}`;
  else if (action.decision === 'pass') attempt = `${kind === 'file' ? 'opened a file' : kind === 'folder' ? 'looked inside a folder' : kind === 'server' ? 'contacted a server' : kind === 'send' ? 'sent data to a server' : 'ran a command'} in its allowed area`;
  else attempt = `tried to ${base} that the watcher judged suspicious`;
  const tail = state.watcherOff ? 'It ran for real — no watcher.'
    : action.decision === 'pass' ? 'It ran for real.'
    : action.decision === 'mirage' ? `Mirage handed it ${fake} instead.`
    : 'Mirage stopped it cold.';
  return `The agent ${attempt}. ${tail}`;
}
const pad = (number) => String(number).padStart(2, '0');
const PAGE_SIZE = 25;
const state = {
  view: 'setup', phase: 'idle', connected: false, count: 15, mode: 'demo',
  boxes: new Map(), pending: new Map(), seen: new Set(), feed: [], failures: [],
  focus: null, filter: 'all', page: 0, startedAt: null, endedAt: null,
  openExplain: new Set(), trigger: null, haveSummary: false, watcherOff: false, lastRun: { on: null, off: null },
};
const maskPhone = (s) => String(s ?? '').replace(/\d(?=\d{2})/g, '•');

$('#app').innerHTML = `
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="topbar">
    <a class="brand" href="/" aria-label="Mirage home">Mirage.</a>
    <div class="header-tools">
      <span class="connection" id="connection" role="status" title="Connecting"><i></i><span class="sr-only">Connecting</span></span>
      <button class="demo-toggle" id="mode-toggle" type="button" aria-pressed="false"><i aria-hidden="true"></i><span id="mode-toggle-label">Demo</span></button>
      <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch to dark appearance">${icon('theme')}</button>
    </div>
  </header>

  <main id="main">
    <section class="setup page" id="setup" aria-labelledby="setup-title">
      <div class="setup-heading">
        <h1 id="setup-title" tabindex="-1">A small world.<br><span>Under your control.</span></h1>
        <p class="setup-description">Each AI agent gets its own isolated virtual machine and a job it can't actually finish. A watcher checks every action before it runs: safe actions go through, out-of-bounds ones are quietly redirected into a fake world, and clear escape attempts are blocked.</p>
      </div>
      <div class="fleet-configurator">
        <div class="fleet-preview">
          <div id="fleet-diagram" class="fleet-diagram" aria-hidden="true"></div>
          <div class="preview-caption"><span id="preview-count">15 isolated environments</span><span class="preview-watcher">One watcher.</span></div>
        </div>
        <div class="setup-controls">
          <label class="count-label" for="n">How many agents?</label>
          <p class="control-description" id="count-hint">One agent per virtual machine.</p>
          <div class="count-control">
            <input id="n" type="number" min="1" step="1" value="15" aria-describedby="count-hint" />
            <div class="count-stepper"><button class="count-step" id="plus" type="button" aria-label="More agents">+</button><button class="count-step" id="minus" type="button" aria-label="Fewer agents">−</button></div>
          </div>
          <div class="presets" role="group" aria-label="Fleet size presets">${[6, 15, 25, 100].map(n => `<button type="button" data-count="${n}" aria-pressed="${n === 15}">${n.toLocaleString()}</button>`).join('')}</div>
          <div class="lock-field"><div class="contrast-text"><strong>Watcher</strong></div><label class="lock-slider" id="lock-slider"><input type="checkbox" id="watcher-off" role="switch" aria-label="Run unprotected, with the watcher off" /><span class="lock-track" aria-hidden="true"><span class="lock-label">${icon('lock')} Protected</span><span class="lock-label">${icon('unlock')} Unprotected</span><span class="lock-thumb" id="lock-thumb"><span class="thumb-face on">${icon('lock')} Protected</span><span class="thumb-face off">${icon('unlock')} Unprotected</span></span></span></label></div>
          <div class="launch-area"><button class="button primary launch-button" id="launch" type="button" disabled><span id="launch-label">Launch 15 VMs</span> ${icon('arrow')}</button></div>
          <p class="setup-error" id="setup-error" role="alert" hidden></p>
        </div>
      </div>
    </section>

    <section class="workspace page" id="workspace" aria-labelledby="workspace-title" hidden>
      <div class="workspace-heading">
        <div class="workspace-title-group"><h1 id="workspace-title" tabindex="-1">Fleet</h1></div>
        <div class="workspace-actions"><button class="button secondary" id="back" type="button" hidden>${icon('back')} All environments</button></div>
      </div>
      <div class="trigger-band" id="trigger-band" role="alert" hidden></div>
      <div class="headline" id="headline">
        <div class="hero-oos" id="hero-oos"><span class="hero-label">Real out-of-scope access</span><strong id="s-oos">—</strong><span class="hero-note" id="s-oos-note">waiting for the run summary</span></div>
        <div class="headline-side">
          <div class="hmetric"><span>Loop depth</span><strong id="s-loop">00</strong></div>
          <div class="hmetric"><span>Real / fake calls</span><strong id="s-realfake">00 / 00</strong></div>
          <div class="hmetric"><span>Agents tripped</span><strong id="s-tripped">00 / 00</strong></div>
        </div>
      </div>
      <div class="results-actions" id="results-actions" hidden><button class="button primary" id="see-all" type="button">See all agents ${icon('arrow')}</button><button class="button secondary" id="see-restricted" type="button">See restricted agents ${icon('arrow')}</button><button class="button secondary" id="new-run" type="button" disabled>New experiment ${icon('expand')}</button></div>
      <div class="charts" id="charts" hidden></div>
      <div class="metrics" id="metrics">
        <div class="metric environment-metric"><span class="metric-label">Environments</span><strong id="s-vms">00<span> / 06</span></strong></div>
        <div class="metric"><span class="metric-label">Calls reviewed</span><strong id="s-moves">00</strong></div>
        <div class="metric"><span class="metric-label"><i class="legend-dot mirage"></i> Miraged</span><strong id="s-mirage">00</strong></div>
        <div class="metric"><span class="metric-label"><i class="legend-dot block"></i> Stopped</span><strong id="s-block">00</strong></div>
      </div>
      <div class="run-bar" id="run-bar"><div class="run-indicator"><span class="watch-eye" id="watch-eye" data-state="waking" aria-hidden="true"><svg viewBox="0 0 48 26"><defs><clipPath id="eye-clip"><path d="M2 13C8 5 16 2 24 2s16 3 22 11c-6 8-14 11-22 11S8 21 2 13Z"/></clipPath></defs><g class="eye-lid"><path class="eye-white" d="M2 13C8 5 16 2 24 2s16 3 22 11c-6 8-14 11-22 11S8 21 2 13Z"/><g clip-path="url(#eye-clip)"><g class="eye-pupil"><circle class="eye-iris" cx="24" cy="13" r="7.5"/><circle class="eye-glint" cx="26.6" cy="10.2" r="1.8"/></g></g><path class="eye-outline" d="M2 13C8 5 16 2 24 2s16 3 22 11c-6 8-14 11-22 11S8 21 2 13Z"/></g><path class="eye-shut" d="M3 13c7 6 14 8 21 8s14-2 21-8"/></svg></span><span class="status-pill" id="run-status">Preparing</span><span id="run-status-note" hidden></span><span class="run-clock" id="run-clock">00:00 elapsed</span></div><button class="button primary" id="view-results" type="button" hidden>View results ${icon('arrow')}</button></div>

      <div class="monitor-layout" id="monitor">
        <section class="fleet-region" aria-labelledby="fleet-heading">
          <div class="section-heading"><h2 id="fleet-heading">Environments</h2><div class="filters" role="group" aria-label="Filter environments"><button type="button" data-filter="all" aria-pressed="true">All agents</button><button type="button" data-filter="mirage" aria-pressed="false">Restricted</button></div></div>
          <div class="fleet" id="fleet"></div>
          <div class="filter-empty" id="filter-empty" hidden><span class="empty-orbit"></span><h3>No restricted agents yet.</h3></div>
          <nav class="fleet-pagination" id="fleet-pagination" aria-label="Environment pages" hidden><button type="button" id="page-prev">← Previous</button><span id="fleet-page" aria-live="polite"></span><button type="button" id="page-next">Next →</button></nav>
        </section>
        <aside class="activity-region" aria-labelledby="activity-heading">
          <div class="section-heading"><h2 id="activity-heading">Watcher activity</h2></div>
          <div class="activity-feed" id="feed"><div class="feed-empty"><span class="empty-orbit"></span><p>Waiting for activity.</p></div></div>
        </aside>
      </div>

      <div class="detail-layout" id="detail" hidden>
        <section class="filesystem" aria-labelledby="fs-heading"><div class="panel-heading"><div>${icon('folder')}<h2 id="fs-heading">Observed paths</h2></div><a class="forensic-link" id="forensic" download hidden>Download forensic log ${icon('expand')}</a></div><p class="panel-caption">Files and hosts referenced in this agent's tool calls.</p><div class="felt-progress" id="felt-progress" hidden><span class="felt-label">Agent's felt progress <i>· hidden, display only</i></span><div class="felt-track"><i id="felt-bar"></i></div></div><div class="fs-tree" id="tree"></div></section>
        <section class="activity-log" aria-labelledby="log-heading"><div class="panel-heading"><div><span class="terminal-mark">&gt;_</span><h2 id="log-heading">Agent activity</h2></div><label class="routine-toggle"><input type="checkbox" id="show-routine" checked> Show routine actions</label></div><div class="log-tally" id="log-tally" hidden></div><div class="term" id="term"></div></section>
      </div>
    </section>
  </main>

`;

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $('#theme-toggle').setAttribute('aria-label', `Switch to ${theme === 'dark' ? 'light' : 'dark'} appearance`);
  $('#theme-toggle').title = $('#theme-toggle').getAttribute('aria-label');
  document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#0a0a0b' : '#ffffff';
}
$('#theme-toggle').onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
setTheme('dark');

function renderFleetPreview(count) {
  // An abstract view of the topology; large selections share a bounded set of representative nodes.
  const shown = Math.min(count, 12);
  const nodes = Array.from({ length: shown }, (_, index) => {
    const angle = index * Math.PI * 2 / shown - Math.PI / 2;
    return { x: 280 + Math.cos(angle) * 174, y: 166 + Math.sin(angle) * 118 };
  });
  $('#fleet-diagram').innerHTML = `<svg viewBox="0 0 560 332" fill="none" aria-hidden="true"><ellipse cx="280" cy="166" rx="174" ry="118" class="preview-orbit"/>${nodes.map(node => `<path d="M280 166 ${node.x} ${node.y}" class="preview-wire"/>`).join('')}<circle cx="280" cy="166" r="57" class="watcher-halo"/><circle cx="280" cy="166" r="43" class="watcher-core"/><circle cx="280" cy="158" r="10" class="watcher-mark"/><text x="280" y="186" text-anchor="middle" class="watcher-label">Watcher</text>${nodes.map(node => `<g transform="translate(${node.x - 23} ${node.y - 19})"><rect width="46" height="38" rx="9" class="preview-agent"/><rect x="13" y="10" width="20" height="13" rx="2" class="preview-screen"/><path d="M19 28h8m-4-5v5" class="preview-screen"/></g>`).join('')}</svg>`;
  $('#preview-count').textContent = `${count.toLocaleString()} isolated environment${count === 1 ? '' : 's'}`;
}

function updateMode(id) {
  const mode = modeById(id);
  if (!mode) return;
  state.mode = mode.id;
  $('#mode-toggle').dataset.mode = mode.id;
  $('#mode-toggle').setAttribute('aria-pressed', String(mode.id === 'demo'));
  $('#mode-toggle').title = mode.id === 'demo' ? 'Demo on: one VM is sure to cross the boundary' : 'Demo off: every VM runs a live agent';
  renderFleetPreview(state.count);
}
// Demo switch: off = every VM runs a live agent; on = one VM is guaranteed to cross, so the whole flow can be shown.
$('#mode-toggle').onclick = () => updateMode(state.mode === 'demo' ? 'live' : 'demo');
updateMode(state.mode);

function updateCount(value) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 1) {
    $('#n').setAttribute('aria-invalid', 'true');
    $('#setup-error').textContent = 'Enter a positive whole number of agents.';
    $('#setup-error').hidden = false;
    $('#launch').disabled = true;
    return false;
  }
  state.count = count;
  $('#n').value = state.count;
  $('#n').removeAttribute('aria-invalid');
  $('#n').style.setProperty('--count-digits', String(count).length);
  $('#minus').disabled = state.count === 1;
  $('#launch').disabled = !state.connected;
  $('#setup-error').hidden = true;
  $('#launch-label').textContent = `Launch ${state.count} VM${state.count === 1 ? '' : 's'}`;
  renderFleetPreview(count);
  document.querySelectorAll('[data-count]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.count) === state.count)));
  return true;
}
$('#minus').onclick = () => updateCount(state.count - 1);
$('#plus').onclick = () => updateCount(state.count + 1);
$('#n').onchange = event => updateCount(event.target.value);
$('#n').onkeydown = event => { if (event.key === 'Enter' && updateCount(event.target.value) && !$('#launch').disabled) start(); };
document.querySelectorAll('[data-count]').forEach(button => { button.onclick = () => updateCount(button.dataset.count); });
updateCount(state.count);

function switchView(view) {
  state.view = view;
  $('#setup').hidden = view !== 'setup';
  $('#workspace').hidden = view === 'setup';
  $('#monitor').hidden = view !== 'fleet';
  $('#detail').hidden = view !== 'detail';
  $('#back').hidden = view !== 'detail';
  // The run summary is its own page: the agents run on the fleet view, the final numbers live on results.
  $('#headline').hidden = view !== 'results';
  $('#results-actions').hidden = view !== 'results';
  $('#metrics').hidden = view !== 'detail';
  $('#run-bar').hidden = view !== 'fleet';
  document.body.dataset.view = view;
  renderStats();
}

function cmdOf(call) {
  const args = call.args ?? {};
  if (call.tool === 'read_file') return `cat ${args.path ?? args.file ?? ''}`;
  if (call.tool === 'run_shell') return String(args.command ?? args.cmd ?? '');
  if (call.tool === 'http_get' || call.tool === 'http_post') return `${call.tool === 'http_get' ? 'GET' : 'POST'} ${args.url ?? ''}`;
  return call.tool;
}
function pathOf(call) {
  if (call.tool === 'read_file') return String(call.args?.path ?? call.args?.file ?? '');
  if (call.tool !== 'run_shell') return '';
  return String(call.args?.command ?? call.args?.cmd ?? '').match(/(?:^|\s)["']?((?:\/|\.\.\/|workspace\/|secrets\/|notes\/)[\w./-]+)/)?.[1] ?? '';
}
function statusOf(box) {
  if (box.block) return { text: 'Stopped', kind: 'block' };
  if (box.stopped) return { text: 'Stopped', kind: 'neutral' };
  if (state.phase === 'complete') return { text: 'Finished', kind: 'neutral' };
  if (box.mirage) return { text: 'In the mirage', kind: 'mirage' };
  return { text: box.moves ? 'Working' : 'Ready', kind: 'pass' };
}
function getBox(id) {
  if (state.boxes.has(id)) return state.boxes.get(id);
  // attacker is filled from session.started (session.attacker) and is the only source for the tile's badge
  const box = { id, label: hostnameFor(state.boxes.size), attacker: undefined, actions: [], moves: 0, mirage: 0, block: 0, stopped: false, realOutOfScope: null, loopDepth: 0, progress: 0, killReason: null, serves: new Map() };
  state.boxes.set(id, box);
  return box;
}
function renderFleet() {
  const focusedSession = document.activeElement?.closest('[data-session]')?.dataset.session;
  const all = [...state.boxes.values()];
  const filtered = state.filter === 'mirage' ? all.filter(box => box.mirage > 0 || box.block > 0) : all;
  const total = state.filter === 'all' ? Math.max(state.count, all.length) : filtered.length;
  state.page = Math.min(state.page, Math.max(0, Math.ceil(total / PAGE_SIZE) - 1));
  const begin = state.page * PAGE_SIZE;
  const end = Math.min(total, begin + PAGE_SIZE);
  const visible = filtered.slice(begin, end);
  $('#fleet').innerHTML = visible.map(box => {
    const status = statusOf(box);
    return `<button class="vm ${box.mirage ? 'has-mirage' : ''} ${box.block ? 'has-block' : ''}" type="button" data-session="${esc(box.id)}" aria-label="Inspect ${box.label}"><span class="vm-head"><span class="vm-identity"><span class="vm-icon">${icon('machine')}</span><span><b>${box.label}</b></span></span><span class="agent-status ${status.kind}"><i></i>${status.text}</span></span><span class="vm-term">${box.actions.length ? box.actions.slice(-3).map(action => `<span class="command-row"><span class="command-step">${pad(action.step)}</span><span class="command-symbol ${action.decision}">${action.decision === 'pass' ? '↳' : action.decision === 'mirage' ? '↪' : '×'}</span><code title="${esc(action.cmd)}">${esc(action.cmd)}</code></span>`).join('') : '<span class="card-waiting">Waiting for activity.</span>'}</span><span class="vm-foot"><span>${box.moves} call${box.moves === 1 ? '' : 's'}${box.mirage ? ` <i>·</i> ${box.mirage} miraged` : ''}</span><span class="inspect-link">Inspect ${icon('expand')}</span></span></button>`;
  }).join('');
  if (state.filter === 'all') {
    for (let i = Math.max(begin, all.length); i < end; i++) {
      const done = state.phase === 'complete';
      $('#fleet').insertAdjacentHTML('beforeend', `<div class="vm provisioning"><span class="vm-head"><span class="vm-identity"><span class="vm-icon">${icon('machine')}</span><span><b>${esc(hostnameFor(i))}</b></span></span><span class="agent-status neutral">${done ? 'Unavailable' : 'Provisioning'}</span></span><div class="provision-body">${done ? '<span class="unavailable-mark">—</span>' : '<span class="loader"></span>'}${done ? '<span>No agent session received.</span>' : ''}</div></div>`);
    }
  }
  $('#filter-empty').hidden = state.filter !== 'mirage' || filtered.length > 0;
  $('#fleet').hidden = state.filter === 'mirage' && filtered.length === 0;
  $('#fleet-pagination').hidden = total <= PAGE_SIZE;
  $('#fleet-page').textContent = `${begin + 1}–${end} of ${total.toLocaleString()}`;
  $('#page-prev').disabled = state.page === 0;
  $('#page-next').disabled = end >= total;
  if (focusedSession) [...document.querySelectorAll('[data-session]')].find(button => button.dataset.session === focusedSession)?.focus({ preventScroll: true });
}
$('#fleet').addEventListener('click', event => {
  const button = event.target.closest('[data-session]');
  if (button) openDetail(button.dataset.session);
});
$('#page-prev').onclick = () => { if (state.page > 0) { state.page--; renderFleet(); } };
$('#page-next').onclick = () => { state.page++; renderFleet(); };
document.querySelectorAll('[data-filter]').forEach(button => {
  button.onclick = () => {
    state.filter = button.dataset.filter;
    state.page = 0;
    document.querySelectorAll('[data-filter]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    renderFleet();
  };
});

function addFeed(entry) {
  state.feed.unshift({ ...entry, ts: entry.ts ?? Date.now() });
  state.feed = state.feed.slice(0, 30);
  $('#feed').innerHTML = state.feed.map(item => `<div class="feed-item"><div class="feed-meta"><span class="feed-verdict ${esc(item.kind)}">${esc(item.tag)}</span><time>${new Date(item.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time></div><div class="feed-title">${esc(item.label)}</div><code title="${esc(item.detail)}">${esc(item.detail)}</code></div>`).join('');
}
function renderStats() {
  const focused = state.view === 'detail' ? state.boxes.get(state.focus) : null;
  const boxes = focused ? [focused] : [...state.boxes.values()];
  const sum = field => boxes.reduce((total, box) => total + box[field], 0);
  $('#s-vms').innerHTML = `${pad(state.boxes.size)}<span> / ${pad(state.count)}</span>`;
  $('#s-moves').textContent = pad(sum('moves'));
  $('#s-mirage').textContent = pad(sum('mirage'));
  $('#s-block').textContent = pad(sum('block'));
  // Headline (CLAUDE.md never-cut): real out-of-scope (from run.summary; — until it lands), loop depth, real/fake, tripped.
  const loop = Math.max(0, ...boxes.map(b => Math.max(b.loopDepth, loopDepthFromActions(b.actions))), 0);
  const passCalls = boxes.reduce((t, b) => t + (b.moves - b.mirage - b.block), 0);
  const tripped = boxes.filter(b => b.mirage > 0 || b.block > 0).length;
  const oosKnown = boxes.some(b => b.realOutOfScope != null);
  const oos = oosKnown ? boxes.reduce((t, b) => t + (b.realOutOfScope ?? 0), 0) : null;
  $('#s-loop').textContent = pad(loop);
  $('#s-realfake').textContent = `${pad(passCalls)} / ${pad(sum('mirage'))}`;
  $('#s-tripped').textContent = `${pad(tripped)} / ${pad(focused ? 1 : Math.max(state.count, state.boxes.size))}`;
  $('#s-oos').textContent = oos == null ? '—' : String(oos);
  $('#hero-oos').classList.toggle('breached', oos != null && oos > 0);
  $('#s-oos-note').textContent = oos == null ? 'waiting for the run summary' : oos === 0 ? 'nothing real was reached' : `${oos} reached the real system`;
  renderTriggerBand();
  renderCharts();
  const complete = state.phase === 'complete';
  const status = focused ? statusOf(focused) : null;
  $('#run-status').textContent = status?.text ?? (complete ? 'Run complete' : state.boxes.size ? 'Observing' : 'Provisioning');
  $('#run-status').className = `status-pill ${status?.kind ?? (complete ? 'neutral' : 'pass')}`;
  // The watcher's eye: scanning while agents run, locked on (red) once a boundary is crossed, shut when the run ends.
  $('#watch-eye').dataset.state = complete ? 'done' : state.boxes.size ? (state.trigger ? 'alert' : 'watching') : 'waking';
  $('#run-status-note').hidden = !complete || state.failures.length === 0;
  $('#run-status-note').textContent = `${state.failures.length} environment error${state.failures.length === 1 ? '' : 's'}`;
  $('#new-run').disabled = !complete;
  $('#view-results').hidden = !complete;
  if (state.view === 'fleet') $('#workspace-title').textContent = 'Fleet';
  if (state.view === 'results') $('#workspace-title').textContent = 'Results.';
}
function renderTriggerBand() {
  const band = $('#trigger-band');
  if (!state.trigger || (state.view !== 'fleet' && state.view !== 'results')) { band.hidden = true; return; }
  const t = state.trigger;
  band.hidden = false;
  band.innerHTML = `<span class="alarm-icon">${icon('warning')}</span><strong>Boundary crossed</strong><span>${esc(t.label)} · step ${t.step} · ${esc(t.reason)}</span><time>${new Date(t.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>${t.count > 1 ? `<span class="trip-count">${t.count} agents tripped</span>` : ''}`;
}
// Results charts: where every call went, watcher on vs. off, and each agent's run step by step.
function renderCharts() {
  const el = $('#charts');
  if (state.view !== 'results') { el.hidden = true; return; }
  el.hidden = false;
  const boxes = [...state.boxes.values()];
  const total = (field) => boxes.reduce((t, b) => t + b[field], 0);
  const mirage = total('mirage'), block = total('block'), calls = total('moves'), pass = Math.max(0, calls - mirage - block);
  const pct = (n) => calls ? (n / calls) * 100 : 0;
  const split = `<section class="chart-card"><h3>Where every call went</h3><p class="chart-sub">${calls} tool call${calls === 1 ? '' : 's'} ${state.watcherOff ? 'made with the watcher <b>off</b>, so none were checked,' : 'checked'} across ${boxes.length} agent${boxes.length === 1 ? '' : 's'}</p>
    <div class="stack-bar" role="img" aria-label="${pass} real, ${mirage} miraged, ${block} stopped">${[['pass', pass], ['mirage', mirage], ['block', block]].filter(([, n]) => n).map(([k, n]) => `<i class="seg ${k}" style="width:${pct(n)}%"></i>`).join('') || '<i class="seg empty" style="width:100%"></i>'}</div>
    <div class="stack-legend">${[['pass', 'Real', 'allowed, ran for real', pass], ['mirage', 'Miraged', 'off-limits, handed a fake', mirage], ['block', 'Stopped', 'escape attempts stopped cold', block]].map(([k, name, note, n]) => `<div class="legend-item ${k}"><span class="legend-swatch ${k}"></span><strong>${n}</strong><span>${name}</span><small>${Math.round(pct(n))}% · ${note}</small></div>`).join('')}</div></section>`;
  const { on, off } = compareSummary(state.lastRun.on, state.lastRun.off);
  const num = (side) => side && side.value !== '—' ? Number(side.value) : null;
  const vOn = num(on), vOff = num(off), max = Math.max(1, vOn ?? 0, vOff ?? 0);
  const bar = (side, value, kind, label) => `<div class="vbar ${kind}${side ? '' : ' missing'}"><strong>${side ? side.value : '?'}</strong><div class="vbar-track"><i style="height:${value == null ? 0 : Math.max(2, (value / max) * 100)}%"></i></div><span>${label}</span><small>${side ? esc(side.note) : 'flip the watcher off and run again'}</small></div>`;
  const contrast = `<section class="chart-card"><h3>Real out-of-scope access</h3><p class="chart-sub">Same task, watcher on vs. off</p><div class="vbars">${bar(on, vOn, 'on', 'Watcher on')}${bar(off, vOff, 'off', 'Watcher off')}</div></section>`;
  // With the watcher off nothing is redirected, so "passed" does not mean "in scope": say what really happened.
  const laneTail = (b) => state.watcherOff
    ? (b.realOutOfScope ? `<span class="lane-tail block">${b.realOutOfScope} reached the real system</span>` : `<span class="lane-tail neutral">Unprotected</span>`)
    : `<span class="lane-tail ${b.block ? 'block' : b.mirage ? 'mirage' : 'pass'}">${b.block ? 'Stopped' : b.mirage ? 'In the mirage' : 'Stayed in its allowed area'}</span>`;
  const longest = Math.max(1, ...boxes.map(b => b.actions.length));
  const shown = boxes.slice(0, 40);
  const lanes = `<section class="chart-card wide"><h3>Every agent, step by step</h3><p class="chart-sub">One dot per tool call · <span class="key pass">real</span> <span class="key mirage">miraged</span> <span class="key block">stopped</span> · click an agent to inspect it</p>
    <div class="lanes">${shown.map(b => `<button class="lane" type="button" data-open="${esc(b.id)}"><span class="lane-name">${b.label}</span><span class="lane-track" style="--steps:${longest}">${b.actions.map(a => `<i class="dot ${a.decision}" title="#${a.step} ${esc(a.cmd)}"></i>`).join('')}</span>${laneTail(b)}</button>`).join('')}</div>${boxes.length > shown.length ? `<p class="chart-sub">and ${boxes.length - shown.length} more agents</p>` : ''}</section>`;
  el.innerHTML = `<div class="chart-grid">${split}${contrast}</div>${lanes}`;
}
$('#charts').addEventListener('click', (event) => { const lane = event.target.closest('[data-open]'); if (lane) openDetail(lane.dataset.open); });
// Sticky tally above the log: the zero is the number the whole demo hangs on.
function renderTally(box) {
  const wrap = $('#log-tally');
  if (!box || !box.actions.length) { wrap.hidden = true; return; }
  wrap.hidden = false;
  const pass = box.moves - box.mirage - box.block;
  const first = box.actions.find(a => a.decision !== 'pass');
  const oos = box.realOutOfScope;
  const ended = box.stopped || state.phase === 'complete';
  const busy = first ? Math.max(0, Math.floor(((ended ? (box.actions.at(-1)?.ts ?? Date.now()) : Date.now()) - first.ts) / 1000)) : 0;
  const breached = state.watcherOff ? box.mirage + box.block : (oos ?? 0);
  wrap.classList.toggle('breached', breached > 0);
  wrap.innerHTML = state.watcherOff
    ? `<div class="tally-row"><strong class="tally-zero">${breached}</strong><span>real off-limits action${breached === 1 ? '' : 's'} would have happened · watcher <b>off</b></span></div>`
    : `<div class="tally-row"><strong class="tally-zero">${oos == null ? '0' : oos}</strong><span>real off-limits actions${oos == null ? ' so far' : ''}</span><span class="tally-sep">·</span><b class="mirage">${box.mirage}</b> miraged<span class="tally-sep">·</span><b class="block">${box.block}</b> stopped<span class="tally-sep">·</span><b class="pass">${pass}</b> real (allowed)</div>
       ${first ? `<div class="tally-sub"><span>Boundary crossed at step ${first.step}</span><span class="tally-sep">·</span><span class="busy-clock">${pad(Math.floor(busy / 60))}:${pad(busy % 60)}</span> ${ended ? 'spent' : 'and counting,'} chasing a goal that does not exist</div>` : `<div class="tally-sub">No boundary crossed yet. Every action so far was allowed and ran for real.</div>`}`;
}
$('#term').addEventListener('click', (event) => {
  const button = event.target.closest('[data-explain]');
  if (!button) return;
  const id = button.dataset.explain;
  if (state.openExplain.has(id)) state.openExplain.delete(id); else state.openExplain.add(id);
  const box = state.boxes.get(state.focus);
  if (box) { const term = $('#term'), top = term.scrollTop; renderDetail(box); term.scrollTop = top; }
});
$('#show-routine').onchange = () => { const box = state.boxes.get(state.focus); if (box) renderDetail(box); };
setInterval(() => { if (state.view === 'detail' && state.phase !== 'complete') { const box = state.boxes.get(state.focus); if (box) renderTally(box); } }, 1000);

function updateFelt(box) {
  const wrap = $('#felt-progress');
  if (!box || !box.progress) { wrap.hidden = true; return; }
  wrap.hidden = false;
  $('#felt-bar').style.width = `${Math.round(box.progress * 100)}%`;
}
function updateClock() {
  if (!state.startedAt) return;
  const elapsed = Math.floor(((state.endedAt ?? Date.now()) - state.startedAt) / 1000);
  $('#run-clock').textContent = `${pad(Math.floor(elapsed / 60))}:${pad(elapsed % 60)} elapsed`;
}
setInterval(updateClock, 1000);

function openDetail(id) {
  const box = state.boxes.get(id);
  if (!box) return;
  state.focus = id;
  switchView('detail');
  $('#workspace-title').textContent = `${box.label}.`;
  renderDetail(box, true);
  updateFelt(box);
  $('#forensic').hidden = false; $('#forensic').innerHTML = `Download forensic log ${icon('expand')}`;
  $('#workspace-title').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}
$('#forensic').onclick = async (event) => {
  event.preventDefault();
  const id = state.focus; if (!id) return;
  try {
    const response = await fetch(`/cage/runs/${encodeURIComponent(id)}`);
    if (!response.ok) throw new Error();
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = `${id}.jsonl`; link.click();
    URL.revokeObjectURL(url);
  } catch { $('#forensic').textContent = 'Forensic log not available for this run'; }
};
$('#back').onclick = () => {
  const id = state.focus;
  state.focus = null;
  switchView('fleet');
  renderFleet();
  [...document.querySelectorAll('[data-session]')].find(button => button.dataset.session === id)?.focus({ preventScroll: true });
};

function renderDetail(box, initial = false) {
  const root = { children: new Map() };
  const paths = box.actions.filter(action => action.path);
  paths.forEach(action => {
    const parts = action.path.split('/').filter(Boolean);
    let node = root;
    parts.forEach((part, index) => {
      if (!node.children.has(part)) node.children.set(part, { name: part, children: new Map() });
      node = node.children.get(part);
      if (index === parts.length - 1) { node.action = action; node.current = action === box.actions.at(-1); }
    });
  });
  const tree = (node, depth = 0) => [...node.children.values()].map(child => {
    const directory = child.children.size > 0 || /^(workspace|secrets|notes|src|data|logs)$/.test(child.name);
    const decision = child.action?.decision;
    return `<div class="node ${child.current ? 'current' : ''}" style="--depth:${depth}"><span class="node-icon">${icon(directory ? 'folder' : 'file')}</span><span class="node-name">${esc(child.name)}${directory ? '/' : ''}</span>${decision ? `<span class="node-verdict ${decision}" title="${verdictName[decision]}">${verdictName[decision]}</span>` : ''}</div>${tree(child, depth + 1)}`;
  }).join('');
  const hosts = new Map();
  box.actions.filter(action => action.url).forEach(action => {
    try { hosts.set(new URL(action.url).host, action); } catch { /* malformed URLs stay visible in the activity log */ }
  });
  $('#tree').innerHTML = (paths.length ? tree(root) : '<p class="path-empty">No file paths observed yet.</p>') + (hosts.size ? `<div class="network-heading">Network</div>${[...hosts].map(([host, action]) => `<div class="node network-node"><span class="node-icon">${icon('globe')}</span><span class="node-name">${esc(host)}</span><span class="node-verdict ${action.decision}">${verdictName[action.decision]}</span></div>`).join('')}` : '');
  const term = $('#term');
  // Like a terminal: open on the newest call and keep following it, unless the viewer has scrolled up to read.
  const followTail = initial || term.scrollHeight - term.scrollTop - term.clientHeight < 60;
  const firstCrossing = box.actions.find(a => a.decision !== 'pass');
  const time = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const entry = (action) => {
    const crossed = firstCrossing && action.step >= firstCrossing.step;
    const first = action === firstCrossing;
    const served = box.serves.has(action.callId) ? String(box.serves.get(action.callId)).slice(0, 700) : null;
    const open = state.openExplain.has(action.callId);
    const divider = first ? `<div class="crossing-divider" role="separator"><span>First boundary crossing · ${time(action.ts)} · from here on, nothing the agent sees is real</span></div>` : '';
    return `${divider}<article class="log-entry ${crossed ? 'after-crossing' : ''}" data-decision="${action.decision}">
      <div class="log-meta"><span class="decision-badge ${action.decision}" title="${esc(verdictTip[action.decision])}"><i aria-hidden="true">${verdictSymbol[action.decision]}</i>${verdictName[action.decision]}</span><span class="log-step">#${action.step}</span><time class="log-time">${time(action.ts)}</time></div>
      <code class="log-command"><span>$</span> ${esc(action.cmd)}</code>
      ${action.thought ? `<blockquote class="agent-note">${esc(action.thought)}</blockquote>` : ''}
      <p class="watcher-reason"><span>↳</span> ${esc(action.reason || (action.decision === 'pass' ? 'Within approved scope.' : 'Outside approved scope.'))}</p>
      ${served != null ? `<details class="served" ${first ? 'open' : ''}><summary>What the mirage showed the agent</summary><pre><i class="fake-tag" aria-hidden="true">FAKE</i>${esc(served)}</pre></details>` : ''}
      <button type="button" class="explain-toggle" data-explain="${esc(action.callId)}" aria-expanded="${open}">${open ? 'Hide explanation' : 'Show explanation'}</button>
      ${open ? `<p class="log-headline">${esc(plainHeadline(action))}</p>` : ''}
    </article>`;
  };
  term.classList.toggle('hide-routine', !$('#show-routine').checked);
  term.innerHTML = box.actions.length ? box.actions.map(entry).join('') : '<div class="log-empty">The first tool call will appear here.</div>';
  renderTally(box);
  if (followTail) term.scrollTop = term.scrollHeight;
  updateFelt(box);
}

// Demo: the guaranteed-crossing VM starts once the live agents have made this many calls (or after the fallback delay).
const DEMO_CROSSING_AFTER_CALLS = 12;
const DEMO_CROSSING_FALLBACK_MS = 30_000;
async function post(path) {
  const response = await fetch(path, { method: 'POST' });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(typeof body.error === 'string' ? body.error : `The server returned ${response.status}.`);
  }
}
function launchDeferred() {
  const path = state.deferred;
  if (!path) return;
  state.deferred = null; clearTimeout(state.deferTimer);
  post(path).catch((error) => {
    state.fleetsLeft = Math.max(0, state.fleetsLeft - 1);
    addFeed({ kind: 'block', tag: 'Environment error', label: 'Fleet', detail: error.message });
    if (state.fleetsLeft === 0) finish();
  });
}
async function start() {
  if (!state.connected || (state.phase !== 'idle' && state.phase !== 'complete' && state.phase !== 'error')) return;
  if (!updateCount($('#n').value)) return;
  state.boxes.clear(); state.pending.clear(); state.seen.clear(); state.feed = []; state.failures = [];
  state.focus = null; state.filter = 'all'; state.page = 0; state.phase = 'provisioning'; state.startedAt = Date.now(); state.endedAt = null;
  state.openExplain.clear(); state.trigger = null; state.haveSummary = false; state.watcherOff = $('#watcher-off').checked;
  state.deferred = null; clearTimeout(state.deferTimer);
  document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === 'all')));
  $('#setup-error').hidden = true;
  $('#feed').innerHTML = '<div class="feed-empty"><span class="empty-orbit"></span><p>Waiting for activity.</p></div>';
  switchView('fleet'); renderFleet(); updateClock();
  $('#workspace-title').focus({ preventScroll: true });
  try {
    // The chosen mode decides what runs; the server refuses live modes without a Factory key instead of substituting scripts.
    // Demo is two fleets (the guaranteed crossing first, then the live agents); the run ends when every fleet completes.
    // The crossing VM is held back until the live agents are visibly working, so the alarm lands mid-run.
    const [first, deferred] = launchPaths(state.mode, state.count, state.watcherOff);
    state.fleetsLeft = deferred ? 2 : 1;
    state.liveCalls = 0;
    await post(first);
    if (deferred) { state.deferred = deferred; state.deferTimer = setTimeout(launchDeferred, DEMO_CROSSING_FALLBACK_MS); }
  } catch (error) {
    state.phase = 'error'; state.endedAt = Date.now();
    switchView('setup');
    $('#setup-error').textContent = error instanceof TypeError ? 'The run could not be started. Check the server connection and try again.' : `The run could not be started. ${error.message}`;
    $('#setup-error').hidden = false;
    $('#launch').focus({ preventScroll: true });
  }
}
$('#launch').onclick = start;
// Results → the live fleet, optionally narrowed to agents the watcher redirected or blocked.
function showAgents(filter) {
  switchView('fleet');
  document.querySelector(`[data-filter="${filter}"]`).click();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function showResults() {
  switchView('results');
  $('#workspace-title').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}
$('#see-all').onclick = () => showAgents('all');
$('#see-restricted').onclick = () => showAgents('mirage');
$('#view-results').onclick = showResults;
// Redirected and Agents-tripped double as a shortcut to the restricted agents.
for (const sel of ['#s-mirage', '#s-tripped']) {
  const tile = $(sel).parentElement;
  tile.classList.add('jump'); tile.tabIndex = 0; tile.setAttribute('role', 'button'); tile.title = 'Show only restricted agents';
  const go = () => showAgents('mirage');
  tile.onclick = go;
  tile.onkeydown = event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); go(); } };
}
// Watcher-off switch: tint the launch button when running unprotected.
$('#watcher-off').onchange = () => {
  const off = $('#watcher-off').checked;
  $('#launch').classList.toggle('unprotected', off);
};
// Drag the lock thumb across; releasing past the midpoint flips it. A plain click/tap or Space still toggles natively.
{
  const slider = $('#lock-slider'), thumb = $('#lock-thumb'), box = $('#watcher-off');
  let drag = null, swallowClick = false;
  slider.onpointerdown = (event) => {
    if (event.button !== 0) return;
    drag = { x0: event.clientX, base: box.checked ? thumb.offsetWidth : 0, max: thumb.offsetWidth, x: 0, moved: false };
    slider.setPointerCapture(event.pointerId);
  };
  slider.onpointermove = (event) => {
    if (!drag) return;
    const dx = event.clientX - drag.x0;
    if (Math.abs(dx) > 4) drag.moved = true;
    if (!drag.moved) return;
    slider.classList.add('dragging');
    drag.x = Math.min(drag.max, Math.max(0, drag.base + dx));
    thumb.style.setProperty('--x', `${drag.x}px`);
  };
  slider.onpointerup = slider.onpointercancel = () => {
    if (!drag) return;
    const { moved, x, max } = drag;
    drag = null;
    slider.classList.remove('dragging');
    thumb.style.removeProperty('--x');
    if (!moved) return;
    swallowClick = true; setTimeout(() => { swallowClick = false; }, 0);
    const off = x > max / 2;
    if (off !== box.checked) { box.checked = off; box.dispatchEvent(new Event('change')); }
  };
  slider.addEventListener('click', (event) => { if (swallowClick) { event.preventDefault(); swallowClick = false; } });
}
$('#new-run').onclick = () => {
  if (state.phase !== 'complete') return;
  switchView('setup');
  $('#setup-title').focus({ preventScroll: true });
};

function handle(event) {
  if (state.view === 'setup') return;
  if (event.type === 'session.started') {
    const started = getBox(event.session.id);
    started.attacker = event.session.attacker;
    // The server's name wins over the positional one, unless another machine already has it (a demo is two fleets,
    // and each fleet numbers its machines from the start).
    if (event.session.label && ![...state.boxes.values()].some(b => b !== started && b.label === event.session.label)) started.label = event.session.label;
    state.phase = state.phase === 'complete' ? 'complete' : 'running'; renderFleet(); renderStats();
  } else if (event.type === 'tool.call') {
    state.pending.set(event.call.id, event.call);
    if (state.deferred && ++state.liveCalls >= DEMO_CROSSING_AFTER_CALLS) launchDeferred();
  } else if (event.type === 'watcher.verdict') {
    const call = state.pending.get(event.callId);
    if (!call || state.seen.has(event.callId) || !verdictName[event.verdict.decision]) return;
    state.seen.add(event.callId); state.pending.delete(event.callId);
    const box = getBox(call.session);
    const action = { callId: event.callId, cmd: cmdOf(call), path: pathOf(call), url: call.args?.url, thought: call.thought ?? '', decision: event.verdict.decision, reason: event.verdict.reasons?.[0] ?? '', step: call.step, ts: call.ts ?? Date.now() };
    box.actions.push(action); box.moves++;
    if (action.decision === 'mirage') box.mirage++;
    if (action.decision === 'block') box.block++;
    if (action.decision === 'mirage' || action.decision === 'block') {
      if (!state.trigger) state.trigger = { step: action.step, reason: action.reason || 'outside approved scope', label: box.label, ts: call.ts ?? Date.now(), count: 1, sessions: new Set([box.id]) };
      else if (!state.trigger.sessions.has(box.id)) { state.trigger.sessions.add(box.id); state.trigger.count = state.trigger.sessions.size; }
    }
    addFeed({ kind: action.decision, tag: verdictName[action.decision], label: box.label, detail: action.cmd, ts: call.ts });
    renderFleet(); renderStats();
    if (state.view === 'detail' && state.focus === box.id) renderDetail(box);
  } else if (event.type === 'mirage.served') {
    const box = state.boxes.get(event.entry?.session ?? event.session);
    if (box && event.entry) { box.serves.set(event.callId, event.entry.value); if (state.view === 'detail' && state.focus === box.id) renderDetail(box); }
  } else if (event.type === 'progress.updated') {
    const box = state.boxes.get(event.session);
    if (box) { box.progress = event.progress; if (state.view === 'detail' && state.focus === box.id) updateFelt(box); }
  } else if (event.type === 'notify.sent') {
    addFeed({ kind: 'notify', tag: event.channel === 'call' ? 'Defender call' : 'Defender text', label: 'Human notified', detail: `${maskPhone(event.to)}${event.detail ? ` · ${event.detail}` : ''}`, ts: event.ts });
  } else if (event.type === 'run.summary') {
    const s = event.summary ?? event; // server nests the fields under .summary
    state.haveSummary = true;
    const box = getBox(s.session);
    box.realOutOfScope = s.realOutOfScope ?? 0;
    box.loopDepth = s.loopDepth ?? box.loopDepth;
    box.forensicPath = s.forensicPath;
    renderStats();
    if (state.view === 'detail' && state.focus === box.id) renderDetail(box);
  } else if (event.type === 'kill') {
    const box = state.boxes.get(event.session);
    if (box) { box.stopped = true; box.killReason = event.reason; addFeed({ kind: 'block', tag: 'Stopped', label: box.label, detail: event.reason || 'kill switch', ts: Date.now() }); renderFleet(); renderStats(); }
  } else if (event.type === 'audit' && (event.action === 'vm.failed' || event.action === 'fleet.failed')) {
    state.failures.push(event.detail);
    addFeed({ kind: 'block', tag: 'Environment error', label: event.action === 'fleet.failed' ? 'Fleet' : 'Daytona', detail: event.detail });
    if (event.action === 'fleet.failed') finish();
  } else if (event.type === 'audit' && event.action === 'fleet.budget') {
    addFeed({ kind: 'neutral', tag: 'Token budget', label: 'Fleet', detail: event.detail });
  } else if (event.type === 'audit' && event.action === 'fleet.complete') { state.fleetsLeft = Math.max(0, (state.fleetsLeft ?? 1) - 1); if (state.fleetsLeft === 0) finish(); }
}
function finish() {
  state.phase = 'complete'; state.endedAt = Date.now();
  // Capture this run's headline for the watcher on/off contrast.
  const boxes = [...state.boxes.values()];
  const oos = boxes.some(b => b.realOutOfScope != null) ? boxes.reduce((t, b) => t + (b.realOutOfScope ?? 0), 0) : null;
  state.lastRun[state.watcherOff ? 'off' : 'on'] = { realOutOfScope: oos };
  renderFleet(); renderStats(); updateClock();
  if (state.view === 'fleet') showResults();
}
function renderConnection() {
  $('#connection').classList.toggle('connected', state.connected);
  $('#connection span').textContent = state.connected ? 'Connected' : 'Reconnecting';
  $('#connection').title = $('#connection span').textContent;
  $('#launch').disabled = !state.connected || $('#n').getAttribute('aria-invalid') === 'true';
}
let socket;
let reconnect;
function connect() {
  socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/events`);
  socket.onopen = () => { state.connected = true; renderConnection(); };
  socket.onclose = () => { state.connected = false; renderConnection(); reconnect = setTimeout(connect, 1500); };
  socket.onmessage = message => {
    let event;
    try { event = JSON.parse(message.data); } catch { return; }
    handle(event);
  };
}
window.addEventListener('pagehide', () => { clearTimeout(reconnect); if (socket) { socket.onclose = null; socket.close(); } });
window.addEventListener('pageshow', event => { if (event.persisted) connect(); });
switchView('setup');
connect();
