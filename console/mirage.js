// The console renders host-side Mirage events. Launching is always an explicit action.
import { FLEET_MODES, modeById, modeSplit, launchPath, attackerBadge, cohortSummary, loopDepthFromActions, compareSummary } from './fleet-mode.js';

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
    globe: '<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.arrow}</svg>`;
};
const verdictName = { pass: 'Passed', mirage: 'Redirected', block: 'Blocked' };
const pad = (number) => String(number).padStart(2, '0');
const PAGE_SIZE = 24;
const state = {
  view: 'setup', phase: 'idle', connected: false, count: 6, mode: 'live',
  boxes: new Map(), pending: new Map(), seen: new Set(), feed: [], failures: [],
  focus: null, filter: 'all', page: 0, startedAt: null, endedAt: null,
  trigger: null, haveSummary: false, watcherOff: false, lastRun: { on: null, off: null },
};
const maskPhone = (s) => String(s ?? '').replace(/\d(?=\d{2})/g, '•');

$('#app').innerHTML = `
  <a class="skip-link" href="#main">Skip to content</a>
  <header class="topbar">
    <a class="brand" href="/" aria-label="Mirage home">Mirage.</a>
    <div class="header-tools">
      <span class="connection" id="connection" role="status" title="Connecting"><i></i><span class="sr-only">Connecting</span></span>
      <button class="theme-toggle" id="theme-toggle" type="button" aria-label="Switch to dark appearance">${icon('theme')}</button>
    </div>
  </header>

  <main id="main">
    <section class="setup page" id="setup" aria-labelledby="setup-title">
      <div class="setup-heading">
        <h1 id="setup-title" tabindex="-1">A small world.<br><span>Under your control.</span></h1>
        <p class="setup-description">Run agents in isolated Daytona VMs, each on a job it cannot finish in scope. The watcher checks every tool call, then lets it through, redirects it into the mirage, or blocks it.</p>
      </div>
      <div class="fleet-configurator">
        <div class="fleet-preview">
          <div id="fleet-diagram" class="fleet-diagram" aria-hidden="true"></div>
          <div class="preview-caption"><span id="preview-count">6 isolated VMs</span><span class="preview-split" id="preview-split"></span><span class="preview-watcher">One watcher.</span></div>
        </div>
        <div class="setup-controls">
          <fieldset class="mode-picker">
            <legend class="count-label">What runs in each VM?</legend>
            <div class="modes">${FLEET_MODES.map(mode => `<label class="mode-option"><input type="radio" name="mode" value="${mode.id}" aria-describedby="mode-detail" ${mode.id === state.mode ? 'checked' : ''} /><span class="mode-name">${esc(mode.name)}</span><span class="mode-split">${esc(mode.split)}</span></label>`).join('')}</div>
            <p class="control-description mode-detail" id="mode-detail" aria-live="polite"></p>
          </fieldset>
          <label class="count-label" for="n">How many agents?</label>
          <p class="control-description" id="count-hint">One agent per virtual machine.</p>
          <div class="count-control">
            <input id="n" type="number" min="1" step="1" value="6" aria-describedby="count-hint" />
            <div class="count-stepper"><button class="count-step" id="plus" type="button" aria-label="More agents">+</button><button class="count-step" id="minus" type="button" aria-label="Fewer agents">−</button></div>
          </div>
          <div class="presets" role="group" aria-label="Fleet size presets">${[6, 25, 100, 1000].map(n => `<button type="button" data-count="${n}" aria-pressed="${n === 6}">${n.toLocaleString()}</button>`).join('')}</div>
          <label class="contrast-toggle"><input type="checkbox" id="watcher-off" /> <span>Run with the watcher <b>off</b> (for the contrast)</span></label>
          <div class="launch-area"><button class="button primary launch-button" id="launch" type="button" disabled><span id="launch-label">Launch 6 VMs</span> ${icon('arrow')}</button></div>
          <p class="setup-error" id="setup-error" role="alert" hidden></p>
        </div>
      </div>
    </section>

    <section class="workspace page" id="workspace" aria-labelledby="workspace-title" hidden>
      <div class="workspace-heading">
        <div class="workspace-title-group"><h1 id="workspace-title" tabindex="-1">Fleet</h1><span class="agent-badge" id="detail-badge" hidden></span></div>
        <div class="workspace-actions"><span class="run-clock" id="run-clock">00:00 elapsed</span><button class="button secondary" id="new-run" type="button" disabled>New experiment ${icon('expand')}</button><button class="button secondary" id="back" type="button" hidden>${icon('back')} All environments</button></div>
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
      <div class="compare" id="compare" hidden></div>
      <div class="metrics" id="metrics">
        <div class="metric environment-metric"><span class="metric-label">Environments</span><strong id="s-vms">00<span> / 06</span></strong></div>
        <div class="metric"><span class="metric-label">Calls reviewed</span><strong id="s-moves">00</strong></div>
        <div class="metric"><span class="metric-label"><i class="legend-dot mirage"></i> Redirected</span><strong id="s-mirage">00</strong></div>
        <div class="metric"><span class="metric-label"><i class="legend-dot block"></i> Blocked</span><strong id="s-block">00</strong></div>
        <div class="run-indicator"><span class="status-pill" id="run-status">Preparing</span><span id="run-status-note" hidden></span></div>
      </div>
      <div class="cohorts" id="cohorts" role="status" aria-label="Results by agent type" hidden></div>

      <div class="monitor-layout" id="monitor">
        <section class="fleet-region" aria-labelledby="fleet-heading">
          <div class="section-heading"><h2 id="fleet-heading">Environments</h2><div class="filters" role="group" aria-label="Filter environments"><button type="button" data-filter="all" aria-pressed="true">All agents</button><button type="button" data-filter="mirage" aria-pressed="false">Redirected</button></div></div>
          <div class="fleet" id="fleet"></div>
          <div class="filter-empty" id="filter-empty" hidden><span class="empty-orbit"></span><h3>No redirects yet.</h3></div>
          <nav class="fleet-pagination" id="fleet-pagination" aria-label="Environment pages" hidden><button type="button" id="page-prev">← Previous</button><span id="fleet-page" aria-live="polite"></span><button type="button" id="page-next">Next →</button></nav>
        </section>
        <aside class="activity-region" aria-labelledby="activity-heading">
          <div class="section-heading"><h2 id="activity-heading">Watcher activity</h2></div>
          <div class="activity-feed" id="feed"><div class="feed-empty"><span class="empty-orbit"></span><p>Waiting for activity.</p></div></div>
        </aside>
      </div>

      <div class="detail-layout" id="detail" hidden>
        <section class="filesystem" aria-labelledby="fs-heading"><div class="panel-heading"><div>${icon('folder')}<h2 id="fs-heading">Observed paths</h2></div><a class="forensic-link" id="forensic" download hidden>Download forensic log ${icon('expand')}</a></div><p class="panel-caption">Files and hosts referenced in this agent's tool calls.</p><div class="felt-progress" id="felt-progress" hidden><span class="felt-label">Agent's felt progress <i>· hidden, display only</i></span><div class="felt-track"><i id="felt-bar"></i></div></div><div class="fs-tree" id="tree"></div></section>
        <section class="activity-log" aria-labelledby="log-heading"><div class="panel-heading"><div><span class="terminal-mark">&gt;_</span><h2 id="log-heading">Agent activity</h2></div></div><div class="term" id="term"></div></section>
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
setTheme('light');

function renderFleetPreview(count) {
  // An abstract view of the topology; large selections share a bounded set of representative nodes.
  // Scripted (simulated) VMs are drawn dashed so the split is visible before launch.
  const shown = Math.min(count, 12);
  const split = modeSplit(state.mode, count);
  const nodes = Array.from({ length: shown }, (_, index) => {
    const angle = index * Math.PI * 2 / shown - Math.PI / 2;
    // half & half launches the two kinds interleaved, so the preview alternates them too
    const simulated = split.live === 0 || (split.simulated > 0 && index % 2 === 1);
    return { x: 280 + Math.cos(angle) * 174, y: 166 + Math.sin(angle) * 118, simulated };
  });
  $('#fleet-diagram').innerHTML = `<svg viewBox="0 0 560 332" fill="none" aria-hidden="true"><ellipse cx="280" cy="166" rx="174" ry="118" class="preview-orbit"/>${nodes.map(node => `<path d="M280 166 ${node.x} ${node.y}" class="preview-wire"/>`).join('')}<circle cx="280" cy="166" r="57" class="watcher-halo"/><circle cx="280" cy="166" r="43" class="watcher-core"/><circle cx="280" cy="158" r="10" class="watcher-mark"/><text x="280" y="186" text-anchor="middle" class="watcher-label">Watcher</text>${nodes.map(node => `<g transform="translate(${node.x - 23} ${node.y - 19})"><rect width="46" height="38" rx="9" class="preview-agent${node.simulated ? ' simulated' : ''}"/><rect x="13" y="10" width="20" height="13" rx="2" class="preview-screen"/><path d="M19 28h8m-4-5v5" class="preview-screen"/></g>`).join('')}</svg>`;
  $('#preview-count').textContent = `${count.toLocaleString()} isolated VM${count === 1 ? '' : 's'}`;
  $('#preview-split').innerHTML = [
    split.live ? `<span><i class="swatch live"></i>${split.live.toLocaleString()} live Droid</span>` : '',
    split.simulated ? `<span><i class="swatch simulated"></i>${split.simulated.toLocaleString()} scripted</span>` : '',
  ].join('');
}

function updateMode(id) {
  const mode = modeById(id);
  if (!mode) return;
  state.mode = mode.id;
  document.querySelectorAll('input[name="mode"]').forEach(input => { input.checked = input.value === mode.id; });
  $('#mode-detail').textContent = mode.detail;
  renderFleetPreview(state.count);
}
document.querySelectorAll('input[name="mode"]').forEach(input => { input.onchange = () => updateMode(input.value); });
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
updateCount(6);

function switchView(view) {
  state.view = view;
  $('#setup').hidden = view !== 'setup';
  $('#workspace').hidden = view === 'setup';
  $('#monitor').hidden = view !== 'fleet';
  $('#detail').hidden = view !== 'detail';
  $('#back').hidden = view !== 'detail';
  $('#detail-badge').hidden = view !== 'detail';
  $('#new-run').hidden = view === 'detail';
  document.body.dataset.view = view;
  setTheme(view === 'fleet' ? 'dark' : 'light');
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
  if (box.block) return { text: 'Blocked', kind: 'block' };
  if (box.stopped) return { text: 'Stopped', kind: 'neutral' };
  if (state.phase === 'complete') return { text: 'Finished', kind: 'neutral' };
  if (box.mirage) return { text: 'In the mirage', kind: 'mirage' };
  return { text: box.moves ? 'Working' : 'Ready', kind: 'pass' };
}
function getBox(id) {
  if (state.boxes.has(id)) return state.boxes.get(id);
  // attacker is filled from session.started (session.attacker) and is the only source for the tile's badge
  const box = { id, label: `VM-${pad(state.boxes.size + 1)}`, attacker: undefined, actions: [], moves: 0, mirage: 0, block: 0, stopped: false, realOutOfScope: null, loopDepth: 0, progress: 0, killReason: null, serves: new Map() };
  state.boxes.set(id, box);
  return box;
}
function renderFleet() {
  const focusedSession = document.activeElement?.closest('[data-session]')?.dataset.session;
  const all = [...state.boxes.values()];
  const filtered = state.filter === 'mirage' ? all.filter(box => box.mirage > 0) : all;
  const total = state.filter === 'all' ? Math.max(state.count, all.length) : filtered.length;
  state.page = Math.min(state.page, Math.max(0, Math.ceil(total / PAGE_SIZE) - 1));
  const begin = state.page * PAGE_SIZE;
  const end = Math.min(total, begin + PAGE_SIZE);
  const visible = filtered.slice(begin, end);
  $('#fleet').innerHTML = visible.map(box => {
    const status = statusOf(box);
    const badge = attackerBadge(box.attacker);
    return `<button class="vm ${box.mirage ? 'has-mirage' : ''} ${box.block ? 'has-block' : ''}" type="button" data-session="${esc(box.id)}" aria-label="Inspect ${box.label}, ${esc(badge.text)}"><span class="vm-head"><span class="vm-identity"><span class="vm-icon">${icon('machine')}</span><span><b>${box.label}</b><span class="agent-badge ${badge.kind}">${esc(badge.text)}</span></span></span><span class="agent-status ${status.kind}"><i></i>${status.text}</span></span><span class="vm-term">${box.actions.length ? box.actions.slice(-3).map(action => `<span class="command-row"><span class="command-step">${pad(action.step)}</span><span class="command-symbol ${action.decision}">${action.decision === 'pass' ? '↳' : action.decision === 'mirage' ? '↪' : '×'}</span><code title="${esc(action.cmd)}">${esc(action.cmd)}</code></span>`).join('') : '<span class="card-waiting">Waiting for activity.</span>'}</span><span class="vm-foot"><span>${box.moves} call${box.moves === 1 ? '' : 's'}${box.mirage ? ` <i>·</i> ${box.mirage} redirected` : ''}</span><span class="inspect-link">Inspect ${icon('expand')}</span></span></button>`;
  }).join('');
  if (state.filter === 'all') {
    for (let i = Math.max(begin, all.length); i < end; i++) {
      const done = state.phase === 'complete';
      $('#fleet').insertAdjacentHTML('beforeend', `<div class="vm provisioning"><span class="vm-head"><span class="vm-identity"><span class="vm-icon">${icon('machine')}</span><span><b>VM-${pad(i + 1)}</b></span></span><span class="agent-status neutral">${done ? 'Unavailable' : 'Provisioning'}</span></span><div class="provision-body">${done ? '<span class="unavailable-mark">—</span>' : '<span class="loader"></span>'}${done ? '<span>No agent session received.</span>' : ''}</div></div>`);
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
  renderCompare();
  // Live and simulated results are always reported side by side, never pooled into one rate.
  const cohorts = cohortSummary([...state.boxes.values()]);
  $('#cohorts').hidden = state.view !== 'fleet' || cohorts.length === 0;
  $('#cohorts').innerHTML = cohorts.map(cohort => `<div class="cohort"><span class="agent-badge ${cohort.kind}">${esc(cohort.label)}</span><span class="cohort-text"><strong>${esc(cohort.text)}</strong>${cohort.kind === 'simulated' ? '<span>Planned by script, not an agent decision.</span>' : cohort.kind === 'live' ? '<span>Unscripted: each agent chose its own calls.</span>' : ''}</span></div>`).join('');
  const complete = state.phase === 'complete';
  const status = focused ? statusOf(focused) : null;
  $('#run-status').textContent = status?.text ?? (complete ? 'Run complete' : state.boxes.size ? 'Observing' : 'Provisioning');
  $('#run-status').className = `status-pill ${status?.kind ?? (complete ? 'neutral' : 'pass')}`;
  $('#run-status-note').hidden = !complete || state.failures.length === 0;
  $('#run-status-note').textContent = `${state.failures.length} environment error${state.failures.length === 1 ? '' : 's'}`;
  $('#new-run').disabled = !complete;
  if (state.view === 'fleet') {
    $('#workspace-title').textContent = 'Fleet';
  }
}
function renderTriggerBand() {
  const band = $('#trigger-band');
  if (!state.trigger || state.view !== 'fleet') { band.hidden = true; return; }
  const t = state.trigger;
  band.hidden = false;
  band.innerHTML = `<strong>Boundary crossed</strong><span>${esc(t.label)} · step ${t.step} · ${esc(t.reason)}</span><time>${new Date(t.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>${t.count > 1 ? `<span class="trip-count">${t.count} agents tripped</span>` : ''}`;
}
function renderCompare() {
  const el = $('#compare');
  const { on, off } = compareSummary(state.lastRun.on, state.lastRun.off);
  if ((!on && !off) || state.view !== 'fleet') { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<h3>Watcher on vs. off</h3><div class="compare-grid">${[on, off].filter(Boolean).map(s => `<div class="compare-card ${s.label.includes('Without') ? 'bad' : 'good'}"><span>${esc(s.label)}</span><strong>${esc(s.value)}</strong><small>${esc(s.note)}</small></div>`).join('')}</div>`;
}
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
  const badge = attackerBadge(box.attacker);
  $('#detail-badge').className = `agent-badge ${badge.kind}`;
  $('#detail-badge').textContent = badge.text;
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
  const followTail = !initial && term.scrollHeight - term.scrollTop - term.clientHeight < 60;
  term.innerHTML = box.actions.length ? box.actions.map(action => `<article class="log-entry"><div class="log-meta"><span class="log-step">#${action.step}</span><span class="decision-badge ${action.decision}">${verdictName[action.decision]}</span></div><code class="log-command"><span>$</span> ${esc(action.cmd)}</code>${action.thought ? `<blockquote class="agent-note">${esc(action.thought)}</blockquote>` : ''}<p class="watcher-reason"><span>↳</span> ${esc(action.reason || (action.decision === 'pass' ? 'Within approved scope.' : 'Outside approved scope.'))}</p>${box.serves.has(action.callId) ? `<details class="served"><summary>What the mirage showed the agent</summary><pre>${esc(String(box.serves.get(action.callId)).slice(0, 700))}</pre></details>` : ''}</article>`).join('') : '<div class="log-empty">The first tool call will appear here.</div>';
  if (initial) term.scrollTop = 0;
  else if (followTail) term.scrollTop = term.scrollHeight;
  updateFelt(box);
}

async function start() {
  if (!state.connected || (state.phase !== 'idle' && state.phase !== 'complete' && state.phase !== 'error')) return;
  if (!updateCount($('#n').value)) return;
  state.boxes.clear(); state.pending.clear(); state.seen.clear(); state.feed = []; state.failures = [];
  state.focus = null; state.filter = 'all'; state.page = 0; state.phase = 'provisioning'; state.startedAt = Date.now(); state.endedAt = null;
  state.trigger = null; state.haveSummary = false; state.watcherOff = $('#watcher-off').checked;
  document.querySelectorAll('[data-filter]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.filter === 'all')));
  $('#setup-error').hidden = true;
  $('#feed').innerHTML = '<div class="feed-empty"><span class="empty-orbit"></span><p>Waiting for activity.</p></div>';
  switchView('fleet'); renderFleet(); updateClock();
  $('#workspace-title').focus({ preventScroll: true });
  try {
    // The chosen mode decides what runs; the server refuses live modes without a Factory key instead of substituting scripts.
    const response = await fetch(launchPath(state.mode, state.count, state.watcherOff), { method: 'POST' });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(typeof body.error === 'string' ? body.error : `The server returned ${response.status}.`);
    }
  } catch (error) {
    state.phase = 'error'; state.endedAt = Date.now();
    switchView('setup');
    $('#setup-error').textContent = error instanceof TypeError ? 'The run could not be started. Check the server connection and try again.' : `The run could not be started. ${error.message}`;
    $('#setup-error').hidden = false;
    $('#launch').focus({ preventScroll: true });
  }
}
$('#launch').onclick = start;
$('#new-run').onclick = () => {
  if (state.phase !== 'complete') return;
  switchView('setup');
  $('#setup-title').focus({ preventScroll: true });
};

function handle(event) {
  if (state.view === 'setup') return;
  if (event.type === 'session.started') {
    getBox(event.session.id).attacker = event.session.attacker;
    state.phase = state.phase === 'complete' ? 'complete' : 'running'; renderFleet(); renderStats();
  } else if (event.type === 'tool.call') {
    state.pending.set(event.call.id, event.call);
  } else if (event.type === 'watcher.verdict') {
    const call = state.pending.get(event.callId);
    if (!call || state.seen.has(event.callId) || !verdictName[event.verdict.decision]) return;
    state.seen.add(event.callId); state.pending.delete(event.callId);
    const box = getBox(call.session);
    const action = { callId: event.callId, cmd: cmdOf(call), path: pathOf(call), url: call.args?.url, thought: call.thought ?? '', decision: event.verdict.decision, reason: event.verdict.reasons?.[0] ?? '', step: call.step };
    box.actions.push(action); box.moves++;
    if (action.decision === 'mirage') box.mirage++;
    if (action.decision === 'block') box.block++;
    if (action.decision === 'mirage' || action.decision === 'block') {
      if (!state.trigger) state.trigger = { step: action.step, reason: action.reason || 'outside approved scope', label: box.label, ts: call.ts ?? Date.now(), count: 1, sessions: new Set([box.id]) };
      else if (!state.trigger.sessions.has(box.id)) { state.trigger.sessions.add(box.id); state.trigger.count = state.trigger.sessions.size; }
    }
    addFeed({ kind: action.decision, tag: verdictName[action.decision], label: `${box.label} · ${attackerBadge(box.attacker).text}`, detail: action.cmd, ts: call.ts });
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
    state.haveSummary = true;
    const box = getBox(event.session);
    box.realOutOfScope = event.realOutOfScope ?? 0;
    box.loopDepth = event.loopDepth ?? box.loopDepth;
    box.forensicPath = event.forensicPath;
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
  } else if (event.type === 'audit' && event.action === 'fleet.complete') finish();
}
function finish() {
  state.phase = 'complete'; state.endedAt = Date.now();
  // Capture this run's headline for the watcher on/off contrast.
  const boxes = [...state.boxes.values()];
  const oos = boxes.some(b => b.realOutOfScope != null) ? boxes.reduce((t, b) => t + (b.realOutOfScope ?? 0), 0) : null;
  state.lastRun[state.watcherOff ? 'off' : 'on'] = { realOutOfScope: oos };
  renderFleet(); renderStats(); updateClock();
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
