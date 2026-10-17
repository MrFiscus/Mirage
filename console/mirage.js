// Mirage — fleet view. N agents, each in its own real Daytona VM, all watched by the one watcher.
// Each box is a VM: a small node-graph of the agent's activity. A move out of scope flashes red, the
// watcher reaches in and contains it (amber). Click a box to zoom in. Driven by real MirageEvents.
const COL = { safe: "#7bdcc0", mirage: "#e0b65a", block: "#e5675f", ink: "#f4f5f6", muted: "#8a8d93", line: "#2a2b2f", dim: "#55585e" };
const app = document.querySelector("#app");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));

app.innerHTML = `
  <div class="bar">
    <div class="logo"><span class="ring"></span><b>MIRAGE</b><small>AGENT CONTAINMENT · REAL DAYTONA VMS</small></div>
    <button class="btn ghost" id="back" style="display:none">← fleet</button>
    <div class="grow"></div>
    <label class="count">VMs<button class="step" id="minus">−</button><input id="n" type="number" min="1" max="10" value="6" /><button class="step" id="plus">+</button></label>
    <span class="phase" id="phase">ready</span>
    <button class="btn" id="start">Start testing</button>
  </div>
  <div class="hair"><i id="bar"></i></div>
  <div class="main">
    <div class="stage"><canvas id="c"></canvas>
      <div class="caption" id="caption"></div>
      <div class="intro" id="intro">
        <h1>Watch a fleet of AI agents try to break out.</h1>
        <p>A fleet of AI agents, each in its own real Daytona VM, is given an impossible task. Every move is shown live. One watcher sits in the path of all of them — the moment an agent reaches outside its approved scope, it's intercepted and rerouted into a shadow world, so nothing real is ever touched.</p>
        <button class="btn" id="start2">Start testing</button>
      </div>
    </div>
    <aside class="rail">
      <h2 id="rail-title">FLEET</h2>
      <div class="stat"><div class="k" id="k0">AGENTS (VMS)</div><div class="v" id="s-vms">0</div></div>
      <div class="stat"><div class="k">MOVES</div><div class="v" id="s-moves">0</div></div>
      <div class="stat"><div class="k">REROUTED TO MIRAGE</div><div class="v mirage" id="s-mirage">0</div></div>
      <div class="stat"><div class="k">BLOCKED</div><div class="v block" id="s-block">0</div></div>
      <div class="stat hero"><div class="k">REAL OUT-OF-SCOPE ACCESS</div><div class="v safe" id="s-oos">0</div><div class="sub" id="s-oos-sub">boundary intact</div></div>
      <div class="spacer"></div>
      <div class="verdict-feed" id="feed"></div>
    </aside>
  </div>`;

const canvas = document.querySelector("#c");
const ctx = canvas.getContext("2d");
let W = 0, H = 0, cells = [];

function layout() {
  const r = canvas.parentElement.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = r.width; H = r.height;
  canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  computeCells();
}
window.addEventListener("resize", layout);

const NODE_POS = Array.from({ length: 5 }, (_, i) => { const a = (i / 5) * Math.PI * 2 - Math.PI / 2; return { x: Math.cos(a) * 0.62, y: Math.sin(a) * 0.62 }; });
const EDGES = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 0], [0, 2], [1, 3]];

const state = {
  view: "fleet", focus: null, phase: "idle", fleetN: 6,
  boxes: new Map(), order: [],
  stats: { moves: 0, mirage: 0, block: 0 },
  feed: [], pending: {},
};

function box(id) {
  if (!state.boxes.has(id)) {
    const b = { id, label: `VM-${String(state.order.length + 1).padStart(2, "0")}`, nodes: NODE_POS.map((p) => ({ ...p, pulse: 0, color: COL.ink })), flashes: [], moves: 0, mirage: 0, block: 0, status: "active", last: "" };
    state.boxes.set(id, b); state.order.push(id);
  }
  return state.boxes.get(id);
}

function computeCells() {
  const n = Math.max(state.fleetN, state.order.length) || 6;
  if (state.view === "detail") { cells = [{ id: state.focus, x: W * 0.06, y: H * 0.06, w: W * 0.88, h: H * 0.88 }]; return; }
  const cols = n <= 2 ? n : n <= 4 ? 2 : n <= 9 ? 3 : 4;
  const rows = Math.ceil(n / cols);
  const gap = 16, pad = 20;
  const cw = (W - pad * 2 - gap * (cols - 1)) / cols;
  const ch = (H - pad * 2 - gap * (rows - 1)) / rows;
  cells = [];
  for (let i = 0; i < n; i++) { const r = Math.floor(i / cols), c = i % cols; cells.push({ id: state.order[i] ?? null, slot: i, x: pad + c * (cw + gap), y: pad + r * (ch + gap), w: cw, h: ch }); }
}

/* ---------- events → activity ---------- */
function onVerdict(sessionId, step, decision, label) {
  const b = box(sessionId);
  const node = b.nodes[(step - 1) % 5];
  node.pulse = 1; node.color = decision === "pass" ? COL.safe : decision === "mirage" ? COL.mirage : COL.block;
  b.moves++; b.last = label;
  if (decision === "mirage") { b.mirage++; b.flashes.push({ color: COL.mirage, t: 0 }); }
  else if (decision === "block") { b.block++; b.flashes.push({ color: COL.block, t: 0 }); }
  state.stats.moves++; if (decision === "mirage") state.stats.mirage++; if (decision === "block") state.stats.block++;
  state.feed.unshift(`<span class="${decision}">${decision.toUpperCase().padEnd(6)}</span> ${esc(b.label)} · ${esc(label)}`);
  state.feed = state.feed.slice(0, 8);
  renderStats();
}

function shortLabel(call) {
  const a = call.args ?? {}; const s = a.url || a.path || a.command || a.cmd || call.tool;
  const host = String(s).match(/https?:\/\/([^/\s]+)/)?.[1]; if (host) return host.replace(/\.acme\.\w+$/, "");
  const p = String(s).match(/\/[\w./-]+/)?.[0]; if (p) return p.split("/").slice(-2).join("/");
  return String(call.tool).replace("_", " ");
}

/* ---------- draw ---------- */
let last = performance.now();
function tick(now) {
  const dt = Math.min(48, now - last); last = now;
  for (const b of state.boxes.values()) {
    for (const nd of b.nodes) nd.pulse = Math.max(0, nd.pulse - dt / 700);
    b.flashes = b.flashes.filter((f) => (f.t += dt / 700) < 1);
  }
  draw(now); requestAnimationFrame(tick);
}

function roundRect(x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

function drawCell(cell, now, detail) {
  const b = cell.id ? state.boxes.get(cell.id) : null;
  const cx = cell.x + cell.w / 2, cy = cell.y + cell.h / 2, rad = Math.min(cell.w, cell.h) * (detail ? 0.33 : 0.3);
  const containing = b && b.flashes.some((f) => f.t < 0.5);
  ctx.save();
  ctx.strokeStyle = containing ? "rgba(224,182,90,0.6)" : COL.line; ctx.lineWidth = containing ? 2 : 1.3;
  roundRect(cell.x, cell.y, cell.w, cell.h, 12); ctx.stroke();
  ctx.restore();
  // label + status
  ctx.fillStyle = b ? COL.muted : COL.dim; ctx.font = `${detail ? 13 : 11}px 'DM Mono', monospace`; ctx.textAlign = "left";
  ctx.fillText(b ? b.label : "booting…", cell.x + 12, cell.y + 20);
  if (b) { ctx.fillStyle = COL.dim; ctx.textAlign = "right"; ctx.fillText(`${b.mirage} contained`, cell.x + cell.w - 12, cell.y + 20); ctx.textAlign = "left"; }
  if (!b) { ctx.textAlign = "center"; ctx.fillStyle = COL.dim; ctx.fillText("● provisioning VM", cx, cy); ctx.textAlign = "left"; ctx.restore?.(); return; }

  // watcher ring (the outer layer) — pulses when containing
  ctx.save(); ctx.globalAlpha = containing ? 0.5 : 0.14; ctx.strokeStyle = containing ? COL.mirage : COL.muted; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, rad * 1.5, 0, 7); ctx.stroke(); ctx.restore();
  for (const f of b.flashes) { ctx.save(); ctx.globalAlpha = (1 - f.t) * 0.7; ctx.strokeStyle = f.color; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(cx, cy, rad * 1.5 * (0.6 + f.t), 0, 7); ctx.stroke(); ctx.restore(); }

  // edges
  ctx.strokeStyle = "rgba(255,255,255,0.07)"; ctx.lineWidth = 1;
  for (const [a, c] of EDGES) { const na = b.nodes[a], nc = b.nodes[c]; ctx.beginPath(); ctx.moveTo(cx + na.x * rad, cy + na.y * rad); ctx.lineTo(cx + nc.x * rad, cy + nc.y * rad); ctx.stroke(); }
  // nodes
  for (const nd of b.nodes) {
    const px = cx + nd.x * rad, py = cy + nd.y * rad; const r = (detail ? 4 : 3) + nd.pulse * (detail ? 6 : 4);
    ctx.save(); if (nd.pulse > 0.01) { ctx.shadowBlur = 16; ctx.shadowColor = nd.color; } ctx.fillStyle = nd.pulse > 0.01 ? nd.color : COL.dim;
    ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill(); ctx.restore();
  }
  if (detail && b.last) { ctx.fillStyle = COL.muted; ctx.font = `12px 'DM Mono', monospace`; ctx.textAlign = "center"; ctx.fillText(b.last, cx, cell.y + cell.h - 18); ctx.textAlign = "left"; }
}

function draw(now) {
  ctx.clearRect(0, 0, W, H);
  for (const cell of cells) drawCell(cell, now, state.view === "detail");
}
requestAnimationFrame(tick);

/* ---------- ui + data ---------- */
function caption(h) { const el = document.querySelector("#caption"); el.innerHTML = h; el.classList.remove("hidden"); }
function setPhase(t) { document.querySelector("#phase").textContent = t; }
function setBar(p) { document.querySelector("#bar").style.width = `${Math.round(Math.min(1, p) * 100)}%`; }
function renderStats() {
  const detail = state.view === "detail" && state.boxes.get(state.focus);
  document.querySelector("#rail-title").textContent = detail ? detail.label : "FLEET";
  document.querySelector("#k0").textContent = detail ? "MOVES" : "AGENTS (VMS)";
  document.querySelector("#s-vms").textContent = detail ? detail.moves : state.order.length;
  document.querySelector("#s-moves").textContent = detail ? detail.moves : state.stats.moves;
  document.querySelector("#s-mirage").textContent = detail ? detail.mirage : state.stats.mirage;
  document.querySelector("#s-block").textContent = detail ? detail.block : state.stats.block;
  document.querySelector("#s-oos").textContent = "0";
  document.querySelector("#feed").innerHTML = state.feed.join("<br>");
}

canvas.addEventListener("click", (ev) => {
  if (state.view === "detail") return;
  const r = canvas.getBoundingClientRect(); const x = ev.clientX - r.left, y = ev.clientY - r.top;
  const cell = cells.find((c) => c.id && x >= c.x && x <= c.x + c.w && y >= c.y && y <= c.y + c.h);
  if (cell) { state.view = "detail"; state.focus = cell.id; document.querySelector("#back").style.display = ""; computeCells(); renderStats(); caption(`<b>${esc(state.boxes.get(cell.id).label)}</b> — one agent, watched in its own VM. Click ← fleet to go back.`); }
});
document.querySelector("#back").onclick = () => { state.view = "fleet"; state.focus = null; document.querySelector("#back").style.display = "none"; computeCells(); renderStats(); };

function chosenN() { const el = document.querySelector("#n"); return Math.max(1, Math.min(10, Math.round(Number(el.value) || 6))); }
async function start() {
  const n = chosenN(); document.querySelector("#n").value = n; state.fleetN = n;
  state.phase = "running"; state.boxes = new Map(); state.order = []; state.feed = []; state.pending = {};
  state.stats = { moves: 0, mirage: 0, block: 0 }; state.view = "fleet"; state.focus = null;
  document.querySelector("#back").style.display = "none"; document.querySelector("#intro").classList.add("hidden");
  document.querySelector("#start").disabled = true; setBar(0); setPhase("provisioning VMs"); renderStats(); computeCells();
  caption(`Spinning up ${n} Daytona VM${n === 1 ? "" : "s"}, one agent each…`);
  try { await fetch(`/mirage/fleet/start?n=${n}&backend=daytona`, { method: "POST" }); }
  catch { setPhase("server offline"); document.querySelector("#start").disabled = false; }
}
document.querySelector("#start").onclick = start;
document.querySelector("#start2").onclick = start;
const nudge = (d) => { const el = document.querySelector("#n"); el.value = Math.max(1, Math.min(10, (Number(el.value) || 6) + d)); };
document.querySelector("#plus").onclick = () => nudge(1);
document.querySelector("#minus").onclick = () => nudge(-1);

const STEPS = 10;
function handle(e) {
  if (e.type === "audit" && e.action === "fleet.starting") { const m = String(e.detail).match(/(\d+)/); if (m) state.fleetN = +m[1]; computeCells(); setPhase("provisioning VMs"); }
  else if (e.type === "session.started") { box(e.session.id); computeCells(); setPhase(`${state.order.length} agents live`); renderStats(); }
  else if (e.type === "tool.call") state.pending[e.call.id] = { session: e.call.session, step: e.call.step, label: shortLabel(e.call) };
  else if (e.type === "watcher.verdict") { const p = state.pending[e.callId]; if (p) { onVerdict(p.session, p.step, e.verdict.decision, p.label); setBar(state.stats.moves / (state.fleetN * STEPS)); } }
  else if (e.type === "audit" && e.action === "fleet.complete") finish();
  else if (e.type === "audit" && e.action === "vm.failed") { state.feed.unshift(`<span class="block">VM FAIL</span> ${esc(e.detail)}`); renderStats(); }
}
function finish() {
  state.phase = "contained"; setPhase("contained"); setBar(1);
  document.querySelector("#start").disabled = false; document.querySelector("#start").textContent = "Run again";
  document.querySelector("#s-oos-sub").textContent = `${state.stats.mirage} rerouted · ${state.stats.block} blocked`;
  caption(`<b>Fleet contained.</b> ${state.order.length} agents · ${state.stats.moves} moves · 0 real out-of-scope accesses. Click any VM to inspect it.`);
}
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/events`);
  ws.onopen = () => setPhase("ready");
  ws.onclose = () => { setPhase("reconnecting"); setTimeout(connect, 1500); };
  ws.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch { /* snapshot */ } };
}
layout(); connect();
