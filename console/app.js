const root = document.querySelector("#root");
const state = { incidents: [], audit: [], calls: [], selectedId: null, connected: false };

const statusLabel = { detected: "Detected", investigating: "Investigating", testing_fix: "Testing fix", awaiting_approval: "Awaiting approval", resolved: "Resolved", fix_rejected: "Fix rejected" };

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character]));
}

function selectedIncident() { return state.incidents.find((incident) => incident.id === state.selectedId) ?? state.incidents[0]; }

function render() {
  const incident = selectedIncident();
  root.innerHTML = `
    <header class="topbar"><div class="brand"><span class="mark">B</span><span>BATMAN <small>DEFENSE CONSOLE</small></span></div><div class="live"><i></i>${state.connected ? "LIVE LINK" : "CONNECTING"}</div></header>
    <main class="shell">
      <section class="hero"><div><p class="eyebrow">SOC / COMMAND VIEW</p><h1>Incidents under watch</h1><p class="lede">Evidence-led response for a synthetic company environment.</p></div><button class="primary" id="start">Start scenario <span>↗</span></button></section>
      <section class="metrics"><div><span>ACTIVE CASES</span><strong>${state.incidents.filter((item) => !["resolved", "fix_rejected"].includes(item.status)).length.toString().padStart(2, "0")}</strong></div><div><span>HIGHEST SEVERITY</span><strong class="danger">${incident?.severity?.toUpperCase() ?? "--"}</strong></div><div><span>CONFIDENCE</span><strong>${incident ? `${Math.round(incident.confidence * 100)}%` : "--"}</strong></div><div><span>PIPELINE</span><strong class="good">${state.connected ? "NOMINAL" : "OFFLINE"}</strong></div></section>
      <div class="grid"><aside class="panel cases"><div class="panel-head"><h2>Case queue</h2><span>${state.incidents.length} total</span></div>${state.incidents.map((item) => `<button class="case ${item.id === incident?.id ? "selected" : ""}" data-id="${item.id}"><div><b>${escapeHtml(item.title)}</b><small>${item.id}</small></div><em class="${item.severity}">${item.severity}</em><label>${statusLabel[item.status]}</label></button>`).join("") || `<p class="empty">No cases yet. Start the demo scenario.</p>`}</aside>
        <section class="main-column">${incident ? detail(incident) : `<div class="panel empty-state"><span class="mark">B</span><h2>Awaiting first signal</h2><p>Start the synthetic incident to open a live case.</p></div>`}<div class="panel audit"><div class="panel-head"><h2>Audit trail</h2><span>immutable stream</span></div>${state.audit.slice(0, 6).map((entry) => `<div class="audit-row"><time>${new Date(entry.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time><b>${escapeHtml(entry.action)}</b><span>${escapeHtml(entry.detail)}</span></div>`).join("") || `<p class="empty">Actions will appear here.</p>`}</div>${callPanel()}</section>
      </div>
    </main>`;
  document.querySelector("#start")?.addEventListener("click", startScenario);
  document.querySelectorAll(".case").forEach((button) => button.addEventListener("click", () => { state.selectedId = button.dataset.id; render(); }));
  document.querySelectorAll("[data-next]").forEach((button) => button.addEventListener("click", () => advance(button.dataset.next)));
}

function detail(incident) {
  const checks = incident.proposedFix?.cloneCheck?.checks ?? [{ name: "Process starts", passed: true }, { name: "Health endpoint", passed: true }, { name: "Key files intact", passed: true }];
  return `<div class="panel detail"><div class="detail-top"><div><p class="eyebrow">${incident.id}</p><h2>${escapeHtml(incident.title)}</h2></div><span class="severity ${incident.severity}">${incident.severity.toUpperCase()} RISK</span></div><div class="progress"><span class="${incident.status}"></span></div><div class="steps">${["detected", "investigating", "testing_fix", "awaiting_approval", "resolved"].map((step) => `<span class="${step === incident.status ? "current" : ""} ${["detected", "investigating", "testing_fix", "awaiting_approval", "resolved"].indexOf(step) < ["detected", "investigating", "testing_fix", "awaiting_approval", "resolved"].indexOf(incident.status) ? "done" : ""}">${statusLabel[step]}</span>`).join("")}</div><div class="summary"><div><h3>Analyst brief</h3><p>${escapeHtml(incident.technicalSummary)}</p></div><div><h3>Business brief</h3><p>${escapeHtml(incident.businessSummary)}</p></div></div><div class="evidence"><div class="panel-head"><h3>Evidence</h3><span>read only</span></div>${incident.evidence.map((line) => `<code>${escapeHtml(line)}</code>`).join("")}</div><div class="fix"><div><h3>Clone check</h3><p>Sandbox replica health before production action.</p></div><div class="checks">${checks.map((check) => `<span class="${check.passed ? "pass" : "fail"}">${check.passed ? "✓" : "×"} ${escapeHtml(check.name)}</span>`).join("")}</div></div><div class="actions"><button data-next="testing_fix">Test fix</button><button data-next="awaiting_approval">Request approval</button><button class="quiet" data-next="resolved">Mark resolved</button></div></div>`;
}

function upsertCall(conversationId, patch) {
  const existing = state.calls.find((call) => call.conversationId === conversationId);
  const call = existing ?? { conversationId, role: "unknown", verified: false, transcript: [], disclosures: [] };
  Object.assign(call, patch);
  state.calls = [call, ...state.calls.filter((item) => item !== call)].slice(0, 10);
  return call;
}

function callPanel() {
  const call = state.calls[0];
  if (!call) return `<div class="panel calls"><div class="panel-head"><h2>Live call</h2><span>photon line</span></div><p class="empty">No calls yet.</p></div>`;
  return `<div class="panel calls"><div class="panel-head"><h2>Live call</h2><span>${escapeHtml(call.conversationId)}</span></div><div class="call-meta"><span>ROLE <b>${escapeHtml(call.role.toUpperCase())}</b></span><span>PHONE <b>${escapeHtml(call.phone ?? "--")}</b></span><span class="${call.verified ? "pass" : "fail"}">${call.verified ? "✓ VERIFIED" : "× UNVERIFIED"}</span><span>CODE ATTEMPTS <b>${call.codeAttempts ?? 0}/3</b></span></div>${call.disclosures.map((item) => `<div class="audit-row"><time>${item.allowed ? "ALLOWED" : "REFUSED"}</time><b class="${item.allowed ? "good" : "danger"}">${escapeHtml(item.role)}</b><span>${escapeHtml(item.fields.join(", ") || "no fields")}</span></div>`).join("")}${call.transcript.map((turn) => `<div class="audit-row"><time>${turn.speaker.toUpperCase()}</time><span class="turn">${escapeHtml(turn.text)}</span></div>`).join("")}</div>`;
}

function handleEvent(event) {
  if (event.type === "snapshot") { state.audit = event.audit; for (const session of [...(event.sessions ?? [])].reverse()) upsertCall(session.conversationId, session); }
  if (event.type === "incident.updated") { state.incidents = [event.incident, ...state.incidents.filter((item) => item.id !== event.incident.id)]; state.selectedId = event.incident.id; }
  if (event.type === "audit") state.audit.unshift(event);
  if (event.type === "call.started") upsertCall(event.session.conversationId, event.session);
  if (event.type === "call.transcript") { const call = upsertCall(event.conversationId, {}); call.transcript.push({ speaker: event.speaker, text: event.text }); }
  if (event.type === "disclosure") { const call = upsertCall(event.conversationId, {}); call.disclosures.unshift(event); }
}

async function startScenario() { const response = await fetch("/api/demo/start", { method: "POST" }); const incident = await response.json(); state.selectedId = incident.id; state.incidents.unshift(incident); render(); }
async function advance(status) { if (!state.selectedId) return; const response = await fetch(`/api/incidents/${state.selectedId}/advance`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) }); const incident = await response.json(); state.incidents = state.incidents.map((item) => item.id === incident.id ? incident : item); render(); }

async function boot() {
  state.incidents = await (await fetch("/api/incidents")).json();
  state.audit = await (await fetch("/api/audit")).json();
  state.selectedId = state.incidents[0]?.id;
  render();
  const protocol = location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${location.host}/events`);
  socket.addEventListener("open", () => { state.connected = true; render(); });
  socket.addEventListener("message", (message) => { handleEvent(JSON.parse(message.data)); render(); });
}
boot();