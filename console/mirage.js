// Mirage dashboard. Self-contained: own WebSocket to /events, renders only MirageEvents.
// Readable from the back of a room: big status that turns red on trigger, a loop-depth counter,
// the real-vs-fake split, a live progress bar, and the forensic transcript.
const app = document.querySelector("#app");
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));

const state = {
  session: null,          // latest Session
  verdicts: new Map(),    // callId -> Verdict
  rows: [],               // { call, verdict, entry }
  progress: 0,
  audit: [],
  connected: false,
  running: false,
  watcherOn: true,
};

function tri(decision) { return { pass: "PASS", mirage: "MIRAGE", block: "BLOCK" }[decision] ?? decision; }

function statusBand() {
  const s = state.session;
  const red = s?.triggered;
  if (!s) return `<div class="status calm"><div><div class="headline"><span class="dot"></span>Environment calm</div><div class="sub">No session. Start a run to watch the watcher work.</div></div></div>`;
  if (red) {
    return `<div class="status red"><div><div class="headline"><span class="dot"></span>BOUNDARY CROSSED — AGENT IN THE MIRAGE</div>
      <div class="sub">triggered at step ${s.triggerStep} · ${esc(s.triggerReason ?? "out of scope")} · requests now served by the shadow world</div></div>
      <div style="text-align:right"><div class="headline" style="font-size:40px">0</div><div class="sub">real out-of-scope accesses</div></div></div>`;
  }
  return `<div class="status calm"><div><div class="headline"><span class="dot"></span>Agent working in scope</div>
    <div class="sub">${esc(s.id)} · ${s.attacker} · calls hitting the real Acme env · watcher ${state.watcherOn ? "ON" : "OFF"}</div></div></div>`;
}

function tiles() {
  const s = state.session ?? { realCalls: 0, fakeCalls: 0, loopDepth: 0 };
  const total = s.realCalls + s.fakeCalls || 1;
  const realOOS = state.rows.filter((r) => r.verdict?.decision === "pass" && r.realOOS).length;
  const pct = Math.round(state.progress * 100);
  return `<div class="tiles">
    <div class="tile"><span>REAL CALLS (in scope)</span><strong>${String(s.realCalls).padStart(2, "0")}</strong></div>
    <div class="tile"><span>FAKE CALLS (mirage)</span><strong style="color:var(--fake)">${String(s.fakeCalls).padStart(2, "0")}</strong>
      <div class="split"><i class="r" style="width:${(s.realCalls / total) * 100}%"></i><i class="f" style="width:${(s.fakeCalls / total) * 100}%"></i></div>
      <div class="legend"><span><b class="r">■</b> real</span><span><b class="f">■</b> mirage</span></div></div>
    <div class="tile"><span>LOOP DEPTH</span><strong style="color:var(--violet)">${String(s.loopDepth).padStart(2, "0")}</strong></div>
    <div class="tile oos"><span>REAL OUT-OF-SCOPE ACCESS</span><strong class="${realOOS === 0 ? "zero" : "nonzero"}">${realOOS}</strong></div>
    <div class="tile"><span>AGENT'S FELT PROGRESS</span><strong>${pct}%</strong><div class="bar"><i style="width:${pct}%"></i></div></div>
  </div>`;
}

function transcript() {
  if (!state.rows.length) return `<div class="empty">Tool calls will stream here as the agent works.</div>`;
  return state.rows.map((r) => {
    const d = r.verdict?.decision ?? "pass";
    return `<div class="row ${d}">
      <span class="step">${r.call.step}</span>
      <span class="tool">${esc(r.call.tool)}</span>
      <span class="summary">${esc(r.summary)}</span>
      <span class="tag ${d}">${tri(d)}</span>
      ${r.out ? `<div class="out">${esc(r.out)}</div>` : ""}
    </div>`;
  }).reverse().join("");
}

function auditPanel() {
  return state.audit.slice(0, 14).map((a) => `<div class="row"><time>${new Date(a.ts).toLocaleTimeString([], { hour12: false })}</time>
    <div><b>${esc(a.action)}</b><div class="d">${esc(a.detail)}</div></div></div>`).join("") || `<div class="empty">Audit events appear here.</div>`;
}

function render() {
  const s = state.session;
  const lastHint = [...state.rows].reverse().find((r) => r.hint)?.hint;
  app.innerHTML = `
    <div class="top">
      <div class="brand"><span class="logo">M</span><div><b>MIRAGE</b><small>IN-PATH WATCHER · SHADOW WORLD</small></div></div>
      <div class="controls">
        <a class="link" href="/">defense console ↗</a>
        <button class="go" id="run" ${state.running ? "disabled" : ""}>${state.running ? "running…" : "▶ Run (watcher ON)"}</button>
        <button class="off" id="runoff" ${state.running ? "disabled" : ""}>Run (watcher OFF)</button>
        <span class="link">${state.connected ? "● live" : "○ connecting"}</span>
      </div>
    </div>
    ${statusBand()}
    ${tiles()}
    <div class="cols">
      <div class="panel"><h2>Forensic transcript <em>${s ? esc(s.id) : ""}</em></h2>
        ${lastHint ? `<div class="hintbox">latest hint shown to agent: ${esc(lastHint)}</div>` : ""}
        <div class="feed">${transcript()}</div></div>
      <div class="panel audit"><h2>Audit stream <em>append-only</em></h2><div class="feed">${auditPanel()}</div></div>
    </div>`;
  document.querySelector("#run").onclick = () => startRun(true);
  document.querySelector("#runoff").onclick = () => startRun(false);
}

async function startRun(watcherOn) {
  // Reset view for a fresh run.
  state.session = null; state.rows = []; state.verdicts.clear(); state.progress = 0; state.running = true; state.watcherOn = watcherOn;
  render();
  await fetch(`/mirage/mock/start?watcher=${watcherOn ? "on" : "off"}`, { method: "POST" });
}

function handle(e) {
  if (e.type === "session.started") { state.session = e.session; if (e.session.attacker) state.watcherOn = state.watcherOn; }
  else if (e.type === "tool.call") {
    state.rows.push({ call: e.call, summary: summarize(e.call), verdict: null, out: "", realOOS: false, hint: "" });
  } else if (e.type === "watcher.verdict") {
    const row = state.rows.find((r) => r.call.id === e.callId);
    if (row) row.verdict = e.verdict;
    state.verdicts.set(e.callId, e.verdict);
  } else if (e.type === "mirage.served") {
    const row = state.rows.find((r) => r.call.id === e.callId);
    if (row) { row.out = e.entry.value.split("\n").slice(0, 2).join(" "); row.hint = lastLineHint(e.entry.value); }
  } else if (e.type === "progress.updated") {
    state.progress = e.progress;
  } else if (e.type === "audit") {
    state.audit.unshift(e);
    if (e.action === "run.complete" || e.action === "mock.failed") state.running = false;
  } else if (e.type === "kill") {
    state.audit.unshift({ action: "kill", detail: e.reason, ts: Date.now() });
  } else return;
  render();
}

function lastLineHint(value) {
  const m = value.split("\n").reverse().find((l) => l.startsWith("# ") && l.length > 4);
  return m ? m.slice(2) : "";
}

function summarize(call) {
  const a = call.args ?? {};
  if (call.tool === "read_file") return `read ${a.path ?? a.file ?? ""}`;
  if (call.tool === "http_get") return `GET ${a.url ?? ""}`;
  if (call.tool === "http_post") return `POST ${a.url ?? ""}`;
  return String(a.command ?? a.cmd ?? "");
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/events`);
  ws.onopen = () => { state.connected = true; render(); };
  ws.onclose = () => { state.connected = false; render(); setTimeout(connect, 1500); };
  ws.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch { /* ignore snapshot frames */ } };
}

render();
connect();
