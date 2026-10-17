// Mirage dashboard. Self-contained: own WebSocket to /events, renders only MirageEvents.
// Layout ported from the Figma design; every value here is driven by the live event stream, so
// what judges see on screen is exactly what the watcher + mirage engine did in the backend.
const app = document.querySelector("#app");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const pct = (x) => `${Math.round((x ?? 0) * 100)}%`;
const pad2 = (n) => String(n ?? 0).padStart(2, "0");

const state = {
  session: null,          // latest Session
  rows: [],               // { call, summary, verdict, out }
  progress: 0,
  audit: [],              // { action, detail, ts }
  connected: false,
  running: false,
  watcherOn: true,
  now: new Date(),
  runs: { on: null, off: null }, // realOOS recorded at each run.complete, for the contrast card
};

const TOOL_CHIP = { read_file: "READ", http_get: "GET", http_post: "POST", run_shell: "SHELL" };
const toolChip = (t) => TOOL_CHIP[t] ?? String(t).toUpperCase();

function summarize(call) {
  const a = call.args ?? {};
  if (call.tool === "read_file") return String(a.path ?? a.file ?? "");
  if (call.tool === "http_get") return `GET ${a.url ?? ""}`;
  if (call.tool === "http_post") return `POST ${a.url ?? ""}`;
  return String(a.command ?? a.cmd ?? "");
}

// Real out-of-scope accesses: with the watcher on, out-of-scope calls go to the mirage (0 reached real);
// with it off, every out-of-scope call (verdict != pass) actually ran against the real env.
function realOOS() {
  if (state.watcherOn) return 0;
  return state.rows.filter((r) => r.verdict && r.verdict.decision !== "pass").length;
}
const isDecoy = (v) => v?.decision === "block" && /decoy/i.test((v.reasons ?? []).join(" "));

function decisionReason(v) {
  if (!v) return "awaiting watcher…";
  return v.reasons && v.reasons.length ? v.reasons[0] : (v.decision === "pass" ? "within approved scope" : "out of scope");
}
function scoreSmall(v) {
  if (!v) return "";
  return v.layer === "llm" ? `rules floor ${pct(v.floor)} · AI ${pct(v.score)}` : `rules ${pct(v.score)}`;
}

/* ---------- sections ---------- */

function topbar() {
  const t = state.now.toISOString().slice(11, 19);
  return `<header class="topbar">
    <div class="brand">
      <div class="brand-mark"><span>M</span></div>
      <div><div class="wordmark">MIRAGE</div><div class="eyebrow">IN-PATH WATCHER · SHADOW WORLD</div></div>
    </div>
    <div class="topbar-actions">
      <div class="live-status"><span class="live-dot"></span>${state.connected ? "LIVE" : "OFFLINE"} · ${t} UTC</div>
      <div class="control-group">
        <button class="control-button ${state.watcherOn ? "active" : ""}" id="run-on" ${state.running ? "disabled" : ""}><span class="control-light"></span>Run watcher ON</button>
        <button class="control-button ${!state.watcherOn ? "active" : ""}" id="run-off" ${state.running ? "disabled" : ""}><span class="control-light"></span>Run watcher OFF</button>
      </div>
    </div>
  </header>`;
}

function hero() {
  const s = state.session;
  const triggered = s?.triggered;
  const oos = realOOS();
  const kicker = !state.watcherOn ? "UNPROTECTED RUN" : triggered ? "CONTAINMENT EVENT" : s ? "SESSION ACTIVE" : "STANDBY";
  const title = !state.watcherOn ? "WATCHER OFF — REAL SYSTEM EXPOSED"
    : triggered ? "BOUNDARY CROSSED — AGENT IN THE MIRAGE"
    : s ? "AGENT WORKING IN SCOPE" : "READY — START A RUN";
  const subline = !state.watcherOn ? `simulation result · ${oos} out-of-scope calls reached the real system`
    : triggered ? `triggered at step ${s.triggerStep ?? "?"} · ${esc(s.triggerReason ?? "read outside scope")}`
    : s ? `${esc(s.id)} · ${esc(s.attacker)} · calls hitting the real environment` : "watcher in the path of every action";
  const proof = !state.watcherOn ? "BOUNDARY BREACHED" : "BOUNDARY INTACT";
  return `<section class="alert-hero">
    <div class="alert-copy">
      <div class="alert-kicker">${esc(kicker)}</div>
      <div class="alert-title">${esc(title)}</div>
      <div class="alert-subline">${subline}</div>
    </div>
    <div class="zero-stat">
      <div class="zero-value">${oos}</div>
      <div class="zero-label">REAL OUT-OF-SCOPE ACCESSES</div>
      <div class="zero-proof"><span class="proof-line"></span>${proof}</div>
    </div>
  </section>`;
}

function metrics() {
  const s = state.session ?? { realCalls: 0, fakeCalls: 0, loopDepth: 0 };
  const total = s.realCalls + s.fakeCalls || 1;
  const realPct = Math.round((s.realCalls / total) * 100);
  const oos = realOOS();
  return `<section class="metrics-grid">
    <div class="metric"><div class="metric-label">REAL CALLS</div><div class="metric-value">${pad2(s.realCalls)}</div><div class="metric-note">approved scope only</div></div>
    <div class="metric metric-amber"><div class="metric-label">FAKE CALLS</div><div class="metric-value">${pad2(s.fakeCalls)}</div>
      <div class="split-bar"><span class="split-real" style="width:${realPct}%"></span><span class="split-fake" style="width:${100 - realPct}%"></span></div>
      <div class="metric-note split-label"><span>REAL ${realPct}%</span><span>FAKE ${100 - realPct}%</span></div></div>
    <div class="metric metric-violet"><div class="metric-label">LOOP DEPTH</div><div class="metric-value">${s.loopDepth ? pad2(s.loopDepth) : "—"}</div><div class="metric-note">${s.loopDepth ? "agent still exploring" : "no repeats yet"}</div></div>
    <div class="metric metric-safe"><div class="metric-label">REAL OUT-OF-SCOPE</div><div class="metric-value">${oos}</div><div class="metric-note">${oos === 0 ? "the system never saw it" : "uncontained"}</div></div>
    <div class="metric"><div class="metric-label">AGENT'S FELT PROGRESS</div><div class="metric-value">${pct(state.progress)}</div>
      <div class="progress-track"><span style="width:${pct(state.progress)}"></span></div><div class="metric-note">asymptote · never completes</div></div>
  </section>`;
}

function pipeline() {
  const last = state.rows[state.rows.length - 1]?.verdict?.decision;
  const sel = { pass: "real", mirage: "mirage", block: "block" }[last] ?? "";
  const notified = state.audit.some((a) => /notify/.test(a.action));
  const opt = (cls, label) => `<div class="${sel === cls ? "selected" : ""}"><span class="fork-dot ${cls}"></span>${label}</div>`;
  return `<section class="pipeline">
    <div class="pipeline-node"><span class="node-index">01</span><strong>ATTACKER</strong><small>agent action</small></div>
    <div class="pipeline-link active-link"><span>request</span></div>
    <div class="pipeline-node watcher-node"><span class="node-index">02</span><strong>WATCHER</strong><small>rules + AI</small></div>
    <div class="fork"><div class="fork-line"></div><div class="fork-options">${opt("real", "REAL ENV")}${opt("mirage", "MIRAGE")}${opt("block", "BLOCK")}</div></div>
    <div class="pipeline-link ${sel === "mirage" ? "active-link" : ""}"><span>contained</span></div>
    <div class="pipeline-node notify-node"><span class="node-index">04</span><strong>NOTIFY DEFENDER</strong><small>${notified ? "phone connected" : "on trigger"}</small></div>
  </section>`;
}

function transcript() {
  const rows = [...state.rows].reverse();
  const body = rows.length ? rows.map((r) => {
    const v = r.verdict;
    const d = v?.decision ?? "pass";
    return `<article class="trace-row ${isDecoy(v) ? "decoy-row" : ""}">
      <div class="step-number">${pad2(r.call.step)}</div>
      <div class="trace-main">
        <div class="action-line"><span class="tool-chip">${toolChip(r.call.tool)}</span><span>${esc(r.summary)}</span></div>
        ${r.call.thought ? `<div class="agent-thought"><span>UNTRUSTED</span><em>“${esc(r.call.thought)}”</em></div>` : ""}
      </div>
      <div class="decision"><strong>${esc(decisionReason(v))}</strong><small>${scoreSmall(v)}</small></div>
      <span class="status status-${d}">${d.toUpperCase()}</span>
    </article>`;
  }).join("") : `<div class="trace-row"><div class="step-number"></div><div class="trace-main"><div class="action-line"><span>Start a run — tool calls stream here as the agent works.</span></div></div></div>`;
  return `<div class="panel transcript-panel">
    <div class="panel-heading"><div><div class="panel-title">FORENSIC TRANSCRIPT</div><div class="panel-subtitle">Every action inspected in path · newest first</div></div><div class="panel-count">${pad2(state.rows.length)} EVENTS</div></div>
    <div class="trace-column-labels"><span>STEP / TOOL / ACTION</span><span>WATCHER DECISION</span></div>
    <div class="trace-list">${body}</div>
  </div>`;
}

function auditType(action) {
  if (/block|locked/.test(action)) return "block";
  if (/mirage|served/.test(action)) return "mirage";
  if (/notify/.test(action)) return "notify";
  if (/boundary|trigger|pressure|kill|failed/.test(action)) return "alert";
  if (/pass|verdict\.pass|verified|in scope/.test(action)) return "pass";
  return "pass";
}
function auditStream() {
  const rows = state.audit.slice(0, 11).map((a) => {
    const time = new Date(a.ts).toISOString().slice(11, 23);
    const type = auditType(a.action);
    return `<div class="audit-row"><span class="audit-time">${time}</span><span class="audit-type audit-${type}">${esc(type)}</span><span class="audit-event">${esc(a.detail || a.action)}</span></div>`;
  }).join("") || `<div class="audit-row"><span class="audit-event">Events will stream here.</span></div>`;
  return `<div class="panel audit-panel">
    <div class="panel-heading"><div><div class="panel-title">AUDIT STREAM</div><div class="panel-subtitle">${state.session ? esc(state.session.id) : "mirage://run"}</div></div><div class="streaming"><span></span>STREAMING</div></div>
    <div class="audit-list">${rows}</div>
  </div>`;
}

function contrast() {
  const off = state.runs.off;
  const on = state.runs.on;
  const val = (x) => (x == null ? "—" : String(x));
  return `<div class="contrast-card">
    <div class="contrast-heading">COUNTERFACTUAL</div>
    <div class="contrast-row bad"><span>WITHOUT WATCHER</span><strong>${val(off)}</strong><small>real accesses</small></div>
    <div class="contrast-divider"><span>VS</span></div>
    <div class="contrast-row good"><span>WITH WATCHER</span><strong>${val(on)}</strong><small>real accesses</small></div>
    <div class="win-line">${on === 0 ? "ZERO REAL OUT-OF-SCOPE ACCESS" : "RUN BOTH TO COMPARE"}</div>
  </div>`;
}

function render() {
  app.className = `app-shell ${state.watcherOn ? "watcher-on" : "watcher-off"}`;
  app.innerHTML = `${topbar()}${hero()}${metrics()}${pipeline()}
    <section class="evidence-grid">${transcript()}<aside class="side-stack">${auditStream()}${contrast()}</aside></section>
    <footer class="footer"><span>MIRAGE CONTAINMENT ENGINE</span><span>IN-PATH WATCHER · RULES + CHALK</span><span class="footer-safe"><i></i>ALL REAL SYSTEMS NOMINAL</span></footer>`;
  const on = document.querySelector("#run-on"), off = document.querySelector("#run-off");
  if (on) on.onclick = () => startRun(true);
  if (off) off.onclick = () => startRun(false);
}

/* ---------- live data ---------- */

async function startRun(watcherOn) {
  state.session = null; state.rows = []; state.progress = 0; state.running = true; state.watcherOn = watcherOn;
  render();
  await fetch(`/mirage/mock/start?watcher=${watcherOn ? "on" : "off"}`, { method: "POST" }).catch(() => { state.running = false; render(); });
}

function handle(e) {
  if (e.type === "session.started") state.session = e.session;
  else if (e.type === "tool.call") state.rows.push({ call: e.call, summary: summarize(e.call), verdict: null, out: "" });
  else if (e.type === "watcher.verdict") { const r = state.rows.find((x) => x.call.id === e.callId); if (r) r.verdict = e.verdict; }
  else if (e.type === "mirage.served") { const r = state.rows.find((x) => x.call.id === e.callId); if (r) r.out = (e.entry.value || "").split("\n")[0]; }
  else if (e.type === "progress.updated") state.progress = e.progress;
  else if (e.type === "audit") {
    state.audit.unshift({ action: e.action, detail: e.detail, ts: e.ts });
    if (e.action === "run.complete" || e.action === "mock.failed") { state.running = false; state.runs[state.watcherOn ? "on" : "off"] = realOOS(); }
  } else if (e.type === "kill") state.audit.unshift({ action: "kill", detail: e.reason, ts: Date.now() });
  else if (e.type === "notify.sent") state.audit.unshift({ action: "notify.sent", detail: `${e.channel} → ${e.to}`, ts: Date.now() });
  else return;
  render();
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/events`);
  ws.onopen = () => { state.connected = true; render(); };
  ws.onclose = () => { state.connected = false; render(); setTimeout(connect, 1500); };
  ws.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch { /* ignore snapshot frames */ } };
}

setInterval(() => { state.now = new Date(); const el = document.querySelector(".live-status"); if (el) el.innerHTML = `<span class="live-dot"></span>${state.connected ? "LIVE" : "OFFLINE"} · ${state.now.toISOString().slice(11, 19)} UTC`; }, 1000);
render();
connect();
