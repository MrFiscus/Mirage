// Mirage — fleet of real agents. Each VM is a live workstation: the agent's actual commands and its
// reasoning stream in a mini-terminal, and the watcher's verdict is shown on every line. Click a VM to
// zoom into a live filesystem tree (the files the agent explores, current one highlighted, out-of-scope
// paths rerouted into the shadow world) + the full reasoning. All driven by the real MirageEvent stream.
const COL = { safe: "#7bdcc0", mirage: "#e0b65a", block: "#e5675f" };
const app = document.querySelector("#app");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const T = { pass: "PASS", mirage: "MIRAGE", block: "BLOCK" };

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
    <div class="stage">
      <div class="fleet" id="fleet"></div>
      <div class="detail" id="detail" style="display:none">
        <div class="detail-fs panel">
          <div class="fs-head"><span id="fs-head">VM</span><span class="fs-now" id="fs-now"></span></div>
          <div class="fs-tree" id="tree"></div>
        </div>
        <div class="detail-term panel"><div class="term-head" id="term-head">agent activity</div><div class="term" id="term"></div></div>
      </div>
      <div class="intro" id="intro">
        <h1>Watch a fleet of AI agents try to break out.</h1>
        <p>A fleet of AI agents, each in its own real Daytona VM, is given an impossible task. You see every command each one runs, live. One watcher sits in the path of all of them — the moment an agent reaches outside its approved scope, it's intercepted and rerouted into a shadow world, so nothing real is ever touched.</p>
        <button class="btn" id="start2">Start testing</button>
      </div>
    </div>
    <aside class="rail">
      <h2 id="rail-title">FLEET</h2>
      <div class="stat"><div class="k" id="k0">AGENTS (VMS)</div><div class="v" id="s-vms">0</div></div>
      <div class="stat"><div class="k">COMMANDS RUN</div><div class="v" id="s-moves">0</div></div>
      <div class="stat"><div class="k">REROUTED TO MIRAGE</div><div class="v mirage" id="s-mirage">0</div></div>
      <div class="stat"><div class="k">BLOCKED</div><div class="v block" id="s-block">0</div></div>
      <div class="stat hero"><div class="k">REAL OUT-OF-SCOPE ACCESS</div><div class="v safe" id="s-oos">0</div><div class="sub" id="s-oos-sub">boundary intact</div></div>
      <div class="spacer"></div>
      <div class="verdict-feed" id="feed"></div>
    </aside>
  </div>`;

const state = { view: "fleet", focus: null, fleetN: 6, boxes: new Map(), order: [], stats: { moves: 0, mirage: 0, block: 0 }, feed: [], pending: {} };

/* ---------- command + path extraction (real tool calls) ---------- */
function cmdOf(call) {
  const a = call.args ?? {};
  if (call.tool === "read_file") return `cat ${a.path ?? ""}`;
  if (call.tool === "run_shell") return `$ ${a.command ?? a.cmd ?? ""}`;
  if (call.tool === "http_get" || call.tool === "http_post") { const u = String(a.url ?? "").replace(/^https?:\/\//, ""); return `${call.tool === "http_get" ? "GET" : "POST"} ${u}`; }
  return `${call.tool} ${JSON.stringify(a).slice(0, 40)}`;
}
function pathOf(call) {
  const a = call.args ?? {};
  if (call.tool === "read_file") return String(a.path || "");
  if (call.tool === "run_shell") { const m = String(a.command || a.cmd || "").match(/(\/[\w./-]+|\.\.\/[\w./-]+)/); return m ? m[1] : ""; }
  return ""; // http is network, not a file
}
const WHY = { pass: () => "within approved scope", mirage: (r) => r || "outside scope — served a fake", block: (r) => r || "escape attempt — blocked" };

/* ---------- fleet grid (DOM cards) ---------- */
const fleetEl = document.querySelector("#fleet");
const gridCols = (n) => (n <= 1 ? 1 : n <= 2 ? 2 : n <= 6 ? 3 : 4);
function layoutGrid() { fleetEl.style.gridTemplateColumns = `repeat(${gridCols(Math.max(state.fleetN, state.order.length) || 1)}, 1fr)`; }

function box(id) {
  if (state.boxes.has(id)) return state.boxes.get(id);
  const label = `VM-${String(state.order.length + 1).padStart(2, "0")}`;
  const el = document.createElement("div"); el.className = "vm"; el.dataset.id = id;
  el.innerHTML = `<div class="vm-head"><b>${label}</b><span class="act">▮ working</span><span class="vm-count">0 contained</span></div><div class="vm-term"></div><div class="scopebar"><i></i></div>`;
  el.onclick = () => openDetail(id);
  const ph = fleetEl.querySelector(".vm.booting"); if (ph) ph.replaceWith(el); else fleetEl.appendChild(el);
  const b = { id, label, actions: [], moves: 0, mirage: 0, block: 0, el };
  state.boxes.set(id, b); state.order.push(id); layoutGrid();
  return b;
}

function pushAction(b, call, verdict) {
  const act = { cmd: cmdOf(call), path: pathOf(call), thought: call.thought || "", decision: verdict.decision, reason: verdict.reasons?.[0] || "", step: call.step };
  b.actions.push(act); b.moves++;
  if (verdict.decision === "mirage") b.mirage++; else if (verdict.decision === "block") b.block++;
  const term = b.el.querySelector(".vm-term");
  term.innerHTML = b.actions.slice(-4).map((a) => `<div class="tl"><span class="chip ${a.decision}">${T[a.decision]}</span><span class="cmd">${esc(a.cmd)}</span></div>`).join("")
    + `<div class="thinking">${esc(b.actions.at(-1).thought)}</div>`;
  b.el.querySelector(".vm-count").textContent = `${b.mirage} contained`;
  b.el.classList.add(verdict.decision === "block" ? "flash-b" : verdict.decision === "mirage" ? "flash-m" : "flash-p");
  setTimeout(() => b.el.classList.remove("flash-m", "flash-b", "flash-p"), 450);
  state.stats.moves++; if (verdict.decision === "mirage") state.stats.mirage++; if (verdict.decision === "block") state.stats.block++;
  state.feed.unshift(`<span class="${verdict.decision}">${T[verdict.decision].padEnd(6)}</span> ${esc(b.label)} · ${esc(act.cmd)}`); state.feed = state.feed.slice(0, 8);
  renderStats();
  if (state.view === "detail" && state.focus === b.id) { renderTree(b); renderDetailTerm(b); }
}

function bootingPlaceholders() {
  const need = Math.max(0, state.fleetN - state.order.length);
  fleetEl.querySelectorAll(".vm.booting").forEach((e) => e.remove());
  for (let i = 0; i < need; i++) { const d = document.createElement("div"); d.className = "vm booting"; d.innerHTML = `<div class="vm-head"><b>VM-${String(state.order.length + i + 1).padStart(2, "0")}</b><span class="act dim">● provisioning</span></div><div class="boot">spinning up Daytona sandbox…</div>`; fleetEl.appendChild(d); }
  layoutGrid();
}

/* ---------- detail: live filesystem tree + reasoning terminal ---------- */
// The in-scope workspace the cage seeds (shown from the start so it reads as a real project). Out-of-scope
// paths are added as the agent discovers them. Access state + verdicts come from real tool calls.
const SKELETON = {
  workspace: { __scope: "in", "README.md": {}, "notes.md": {}, src: { "main.py": {}, "util.py": {} }, data: { "samples.json": {} }, logs: { "run.log": {} } },
};

function openDetail(id) {
  state.view = "detail"; state.focus = id;
  document.querySelector("#fleet").style.display = "none";
  document.querySelector("#detail").style.display = "flex";
  document.querySelector("#back").style.display = "";
  const b = state.boxes.get(id);
  document.querySelector("#fs-head").textContent = `${b.label} · filesystem`;
  document.querySelector("#term-head").textContent = `${b.label} · agent activity`;
  renderTree(b); renderDetailTerm(b); renderStats();
}
function closeDetail() { state.view = "fleet"; state.focus = null; document.querySelector("#detail").style.display = "none"; document.querySelector("#fleet").style.display = "grid"; document.querySelector("#back").style.display = "none"; renderStats(); }
document.querySelector("#back").onclick = closeDetail;

function buildTree(actions) {
  const root = {};
  const clone = (src, scope) => { const o = { __dir: true, __scope: scope }; for (const k in src) { if (k === "__scope") continue; const v = src[k]; o[k] = Object.keys(v).filter((x) => x !== "__scope").length ? clone(v, scope) : { __file: true, __scope: scope }; } return o; };
  root.workspace = clone(SKELETON.workspace, "in");
  let current = null;
  actions.forEach((a, i) => {
    if (!a.path) return;
    const segs = a.path.replace(/^\//, "").split("/").filter(Boolean);
    const outside = !a.path.replace(/^\//, "").startsWith("workspace");
    let node = root;
    segs.forEach((seg, j) => {
      const leaf = j === segs.length - 1;
      if (!node[seg]) node[seg] = leaf ? { __file: true, __scope: outside ? "out" : "in" } : { __dir: true, __scope: outside ? "out" : "in" };
      if (leaf) { node[seg].__access = a.decision; if (i === actions.length - 1) { node[seg].__current = true; current = { path: a.path, decision: a.decision }; } }
      node = node[seg];
    });
  });
  return { root, current };
}

function treeHtml(node, name, depth) {
  const pad = depth * 14;
  if (node.__file) {
    const cls = ["file"]; if (node.__scope === "out") cls.push("out"); if (node.__access) cls.push("acc", node.__access); if (node.__current) cls.push("current");
    const tag = node.__access === "block" ? "blocked" : node.__access === "mirage" ? "rerouted → mirage" : node.__access === "pass" ? "read" : "";
    return `<div class="node ${cls.join(" ")}" style="padding-left:${pad}px"><span class="ic">•</span>${esc(name)}${node.__current ? `<span class="reading">● exploring</span>` : tag ? `<span class="ntag">${tag}</span>` : ""}</div>`;
  }
  const kids = Object.keys(node).filter((k) => !k.startsWith("__"));
  const cls = node.__scope === "out" ? "dir out" : "dir";
  const head = name ? `<div class="node ${cls}" style="padding-left:${pad}px"><span class="ic">▾</span>${esc(name)}/${node.__scope === "out" ? `<span class="ntag">outside scope</span>` : ""}</div>` : "";
  return head + kids.map((k) => treeHtml(node[k], k, name ? depth + 1 : depth)).join("");
}

function renderTree(b) {
  const { root, current } = buildTree(b.actions);
  document.querySelector("#tree").innerHTML = treeHtml({ __dir: true, ...root }, "", 0) || `<div class="muted">waiting for the agent…</div>`;
  const now = document.querySelector("#fs-now");
  now.innerHTML = current ? `exploring <b>${esc(current.path)}</b> <span class="chip ${current.decision}">${T[current.decision]}</span>` : "";
  const cur = document.querySelector("#tree .current"); if (cur) cur.scrollIntoView({ block: "nearest" });
}

function renderDetailTerm(b) {
  document.querySelector("#term").innerHTML = b.actions.map((a) => `<div class="line"><div class="l1"><span class="chip ${a.decision}">${T[a.decision]}</span><span class="cmd">${esc(a.cmd)}</span></div>${a.thought ? `<div class="l2">“${esc(a.thought)}”</div>` : ""}<div class="l3">watcher: ${esc(WHY[a.decision](a.reason))}</div></div>`).join("");
  const term = document.querySelector("#term"); term.scrollTop = term.scrollHeight;
}

/* ---------- ui + data ---------- */
function setPhase(t) { document.querySelector("#phase").textContent = t; }
function setBar(p) { document.querySelector("#bar").style.width = `${Math.round(Math.min(1, p) * 100)}%`; }
function renderStats() {
  const d = state.view === "detail" && state.boxes.get(state.focus);
  document.querySelector("#rail-title").textContent = d ? d.label : "FLEET";
  document.querySelector("#k0").textContent = d ? "COMMANDS RUN" : "AGENTS (VMS)";
  document.querySelector("#s-vms").textContent = d ? d.moves : state.order.length;
  document.querySelector("#s-moves").textContent = d ? d.moves : state.stats.moves;
  document.querySelector("#s-mirage").textContent = d ? d.mirage : state.stats.mirage;
  document.querySelector("#s-block").textContent = d ? d.block : state.stats.block;
  document.querySelector("#s-oos").textContent = "0";
  document.querySelector("#feed").innerHTML = state.feed.join("<br>");
}
const chosenN = () => Math.max(1, Math.min(10, Math.round(Number(document.querySelector("#n").value) || 6)));
const nudge = (dd) => { const el = document.querySelector("#n"); el.value = Math.max(1, Math.min(10, (Number(el.value) || 6) + dd)); };
document.querySelector("#plus").onclick = () => nudge(1);
document.querySelector("#minus").onclick = () => nudge(-1);

async function start() {
  const n = chosenN(); document.querySelector("#n").value = n; state.fleetN = n;
  state.boxes = new Map(); state.order = []; state.feed = []; state.pending = {}; state.stats = { moves: 0, mirage: 0, block: 0 };
  closeDetail(); fleetEl.innerHTML = ""; bootingPlaceholders();
  document.querySelector("#intro").classList.add("hidden"); document.querySelector("#start").disabled = true;
  setBar(0); setPhase("provisioning VMs"); renderStats();
  try { await fetch(`/mirage/fleet/start?n=${n}&backend=daytona`, { method: "POST" }); }
  catch { setPhase("server offline"); document.querySelector("#start").disabled = false; }
}
document.querySelector("#start").onclick = start;
document.querySelector("#start2").onclick = start;

const STEPS = 10;
function handle(e) {
  if (e.type === "audit" && e.action === "fleet.starting") { const m = String(e.detail).match(/(\d+)/); if (m) state.fleetN = +m[1]; bootingPlaceholders(); setPhase("provisioning VMs"); }
  else if (e.type === "session.started") { box(e.session.id); bootingPlaceholders(); setPhase(`${state.order.length} agents live`); renderStats(); }
  else if (e.type === "tool.call") state.pending[e.call.id] = e.call;
  else if (e.type === "watcher.verdict") { const call = state.pending[e.callId]; if (call) { pushAction(box(call.session), call, e.verdict); setBar(state.stats.moves / (state.fleetN * STEPS)); } }
  else if (e.type === "audit" && e.action === "fleet.complete") finish();
  else if (e.type === "audit" && e.action === "vm.failed") { state.feed.unshift(`<span class="block">VM FAIL</span> ${esc(e.detail)}`); renderStats(); }
}
function finish() {
  setPhase("contained"); setBar(1); document.querySelector("#start").disabled = false; document.querySelector("#start").textContent = "Run again";
  document.querySelector("#s-oos-sub").textContent = `${state.stats.mirage} rerouted · ${state.stats.block} blocked`;
  fleetEl.querySelectorAll(".vm:not(.booting) .act").forEach((a) => { a.textContent = "✓ contained"; a.classList.add("done"); });
}
function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/events`);
  ws.onopen = () => setPhase("ready"); ws.onclose = () => { setPhase("reconnecting"); setTimeout(connect, 1500); };
  ws.onmessage = (m) => { try { handle(JSON.parse(m.data)); } catch { /* snapshot */ } };
}
connect();
