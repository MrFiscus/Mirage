// Demo panel (Person 2). Self-contained: own WebSocket, renders into #defense-demo, never touches app.js state.
const host = document.querySelector("#defense-demo");
const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const DONE = ["resolved", "fix_rejected"];
const state = { info: null, open: true, run: null, error: "" };

const scenarios = [
  { id: "1", name: "1 · Approve path", blurb: "Fix passes the clone check, then waits for the analyst's APPROVE" },
  { id: "2", name: "2 · Harmful fix", blurb: "Proposed fix breaks the app; the clone check rejects it" },
  { id: "3", name: "3 · Auto-apply", blurb: "Low-risk fix passes the clone check and applies itself" },
];

const running = () => state.run && !state.run.failed && !(state.run.incident && DONE.includes(state.run.incident.status));

function verdict(incident) {
  const fix = incident?.proposedFix;
  if (incident?.status === "fix_rejected") return `<div class="dd-verdict bad">REJECTED. The live system was not changed.</div>`;
  if (incident?.status === "resolved") return `<div class="dd-verdict ok">Fix applied and verified clean.</div>`;
  if (incident?.status === "awaiting_approval") return `<div class="dd-verdict wait">Passed the clone's health checks. Waiting for analyst approval.</div>`;
  if (fix?.cloneCheck) return "";
  return `<div class="dd-verdict idle">${incident ? "Fix is being planned and tested on a clone." : "Waiting for the first signal."}</div>`;
}

function render() {
  const run = state.run;
  const incident = run?.incident;
  const fix = incident?.proposedFix;
  const checks = fix?.cloneCheck?.checks ?? [];
  const busy = running();
  host.className = state.open ? "open" : "closed";
  host.innerHTML = `
    <div class="dd-bar"><b>DEMO CONTROLS</b><span class="dd-badge">sandbox: ${esc(state.info?.backend ?? "?")}</span>
      <span class="dd-status">${run ? (incident ? esc(incident.status.replace("_", " ")) : busy ? "starting" : "idle") : "ready"}</span>
      <button class="dd-toggle" id="dd-toggle">${state.open ? "Hide ▾" : "Show ▴"}</button></div>
    ${state.open ? `<div class="dd-body">
      <section class="dd-col"><h3>Scenario</h3>
        ${scenarios.map((s) => `<button class="dd-scn" data-scn="${s.id}" ${busy ? "disabled" : ""}><strong>${esc(s.name)}</strong><span>${esc(s.blurb)}</span></button>`).join("")}
        ${state.error ? `<p class="dd-err">${esc(state.error)}</p>` : ""}
      </section>
      <section class="dd-col"><h3>Run log</h3><div class="dd-log">
        ${run ? run.log.slice(-12).reverse().map((l) => `<div class="dd-row"><time>${new Date(l.ts).toLocaleTimeString([], { hour12: false })}</time><b>${esc(l.action)}</b><span>${esc(l.detail)}</span></div>`).join("") || `<p class="dd-muted">Working…</p>` : `<p class="dd-muted">Pick a scenario to run the full loop.</p>`}
      </div></section>
      <section class="dd-col"><h3>Fix and clone check</h3>
        ${verdict(incident)}
        ${checks.length ? `<ul class="dd-checks">${checks.map((c) => `<li class="${c.passed ? "pass" : "fail"}"><i>${c.passed ? "✓" : "✗"}</i>${esc(c.name)}</li>`).join("")}</ul>` : ""}
        ${fix?.commands?.length ? `<details ${checks.length ? "" : "open"}><summary>Fix commands (${fix.commands.length})</summary><pre>${esc(fix.commands.join("\n"))}</pre></details>` : ""}
        ${incident?.status === "awaiting_approval" ? `<button class="dd-approve" id="dd-approve">Simulate analyst APPROVE text</button>` : ""}
      </section></div>` : ""}`;
  document.body.style.paddingBottom = state.open ? "340px" : "56px";
  host.querySelector("#dd-toggle").onclick = () => { state.open = !state.open; render(); };
  host.querySelectorAll(".dd-scn").forEach((b) => (b.onclick = () => start(b.dataset.scn)));
  const a = host.querySelector("#dd-approve");
  if (a) a.onclick = approve;
}

async function start(id) {
  state.error = "";
  try {
    const r = await fetch(`/defense/scenario/${id}/start`, { method: "POST" });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || r.statusText);
    state.run = { id: body.incidentId, incident: null, log: [], failed: false };
  } catch (e) { state.error = String(e.message || e); }
  render();
}

async function approve() {
  try {
    const r = await fetch(`/defense/demo-approve/${state.run.id}`, { method: "POST" });
    if (!r.ok) throw new Error((await r.json()).error);
  } catch (e) { state.error = String(e.message || e); render(); }
}

function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/events`);
  ws.onmessage = (m) => {
    const e = JSON.parse(m.data);
    const run = state.run;
    if (!run) return;
    if (e.type === "incident.updated" && e.incident.id === run.id) run.incident = e.incident;
    else if (e.type === "audit") { run.log.push(e); if (e.action === "scenario.failed") { run.failed = true; state.error = e.detail; } }
    else if (e.type === "sms.sent") run.log.push({ ts: Date.now(), action: "sms", detail: e.body });
    else return;
    render();
  };
  ws.onclose = () => setTimeout(connect, 2000);
}

fetch("/defense/info").then((r) => r.json()).then((i) => { state.info = i; render(); }).catch(() => render());
render();
connect();
