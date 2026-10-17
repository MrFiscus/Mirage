// Judge-facing demo (Person 2). A plain ticketing view; each ticket's activity comes from the engine's step record.
const app = document.querySelector("#app");
const bar = document.querySelector("#presenter");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const DONE = new Set(["resolved", "fix_rejected"]);
const DEMO_PREFIXES = ["inc-low-", "inc-high-", "inc-agent-"];
const DEPT = "CSOC";
const isAgent = (inc) => String(inc?.id ?? "").startsWith("inc-agent-");

const STATUS = {
  detected: ["New", "s-new"],
  investigating: ["In Progress", "s-progress"],
  testing_fix: ["Testing Fix", "s-progress"],
  awaiting_approval: ["Waiting for Approval", "s-wait"],
  resolved: ["Resolved", "s-ok"],
  fix_rejected: ["Closed - Not Fixed", "s-bad"],
};
const PRIORITY = { low: "Low", medium: "Medium", high: "High" };

const loadedAt = Date.now();
const ago = (min) => loadedAt - min * 60_000;
const FILLER = [
  { no: "20812997", status: ["New", "s-new"], title: "VPN access request for new contractor", priority: "low", modified: ago(14) },
  { no: "20813639", status: ["New", "s-new"], title: "Phishing email reported: \"Payroll update required\"", priority: "medium", modified: ago(26) },
  { no: "20814728", status: ["In Progress", "s-progress"], title: "Review admin consent request for a calendar app", priority: "low", modified: ago(41) },
  { no: "20814102", status: ["Waiting on Customer", "s-wait"], title: "Locked out after password reset", priority: "low", modified: ago(58) },
  { no: "20813877", status: ["In Progress", "s-progress"], title: "Replace lost MFA device", priority: "medium", modified: ago(73) },
  { no: "20812560", status: ["New", "s-new"], title: "Shared drive access for Marketing interns", priority: "low", modified: ago(96) },
  { no: "20811934", status: ["In Progress", "s-progress"], title: "Laptop slow after security update", priority: "low", modified: ago(130) },
];

// Who did each step (chip in the feed), and which system in the sidebar it belongs to.
const WHO = {
  batman: ["Batman", "w-batman", null], sandbox: ["Daytona", "w-daytona", "daytona"], sim: ["Demo setup", "w-sim", null],
  edr: ["Endpoint (EDR)", "w-daytona", "logs"], idp: ["Identity", "w-daytona", "logs"],
  virustotal: ["VirusTotal*", "w-elevenlabs", "intel"], ipinfo: ["IPinfo*", "w-elevenlabs", "intel"], abuseipdb: ["AbuseIPDB*", "w-elevenlabs", "intel"],
  gemini: ["Gemini", "w-gemini", "gemini"], rules: ["Rules", "w-batman", "gemini"], droid: ["Factory Droid", "w-droid", "droid"], scripted: ["Scripted plan*", "w-droid", "droid"],
  aiagent: ["AI agent (simulated)", "w-sim", null], harness: ["Agent harness", "w-daytona", "logs"], sensor: ["Decoy sensor", "w-daytona", "logs"],
  photon: ["Photon", "w-photon", "photon"], elevenlabs: ["ElevenLabs", "w-photon", "elevenlabs"], analyst: ["Analyst", "w-analyst", null],
};
const SYSTEMS = [
  { key: "daytona", name: "Daytona", role: "Robin's PC and the test copy" },
  { key: "logs", name: "Endpoint & identity logs", role: "Read-only queries on the PC" },
  { key: "intel", name: "Threat intelligence", role: "VirusTotal, IPinfo, AbuseIPDB" },
  { key: "gemini", name: "Gemini", role: "AI investigator, checked in code" },
  { key: "droid", name: "Factory Droid", role: "Fix planner" },
  { key: "photon", name: "Photon", role: "Texts the on-call analyst" },
  { key: "elevenlabs", name: "ElevenLabs", role: "Calls the analyst on urgent alerts" },
];

let clearedBefore = 0;
try { clearedBefore = Number(localStorage.getItem("batman-demo-cleared") || 0); } catch { /* storage blocked */ }

const state = {
  info: null,
  view: { name: "queue" },
  tickets: new Map(),     // id -> { incident, trace, history: bool, fresh: bool, shown: Set }
  active: null,           // incident id of the run this page started
  starting: false,
  acting: false,
  error: "",
  techOpen: false,
};

const ticketNo = (id) => String(20815000 + (parseInt(id.split("-").pop(), 36) % 1000));
const timeOf = (ts) => new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
function relative(ts) {
  const m = Math.round((Date.now() - ts) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  return `${Math.floor(m / 60)} hr ago`;
}
const pct = (n) => `${Math.round(Number(n) * 100)}%`;
const declared = (inc) => inc.evidence?.length > 0;   // the AI has set the priority
const machineName = () => (state.info?.backend === "daytona" ? "Daytona" : "Sandbox");

/* ---------- the step record → plain-language feed ---------- */

function feedFrom(trace, inc) {
  if (!trace) return [];
  const out = [];
  const pc = String(trace.id ?? inc?.id ?? "").startsWith("inc-agent-") ? "the build runner" : "Robin's PC";
  for (const s of trace.steps) {
    const d = s.data;
    const e = { ts: s.at, key: `${s.kind}-${s.at}` };
    switch (s.kind) {
      case "machine.created": out.push({ ...e, who: "sandbox", text: `Connected to ${pc}`, query: `${machineName()}: create sandbox ${d.id}` }); break;
      case "threat.started": out.push({ ...e, who: "sim", text: d.text ?? "Simulated threat started", query: "Harmless setup script written for this demo" }); break;
      case "alert": out.push({ ...e, who: "batman", text: `Ticket ${ticketNo(trace.id ?? inc.id)} opened and assigned to Batman` }); break;
      case "agent": out.push({ ...e, who: d.who, text: d.text, query: d.query }); break;
      case "investigation": {
        const asked = Boolean(d.trace?.model);                 // Gemini was asked (its answer may still have been rejected)
        const gem = asked;
        const g = d.trace?.guard ?? "";
        const rejected = /^Rejected/.test(g);
        out.push({ ...e, who: gem ? "gemini" : "rules",
          text: `${!gem ? "Built-in rules reviewed" : rejected ? "AI reviewed" : "AI reviewed"} ${d.evidence?.length ?? 0} pieces of evidence: priority ${PRIORITY[d.severity]}, ${pct(d.confidence)} confident`,
          sub: gem ? (rejected ? `Guardrail rejected the AI's answer (${g.replace(/^Rejected Gemini's answer: /, "").replace(/\. The built-in rules answered instead\.$/, "")}); built-in rules set the priority instead` : /raised/.test(g) ? "Guardrail raised the AI's priority to match the evidence" : "Passed every guardrail check") : "",
          query: gem ? `POST generativelanguage.googleapis.com/v1beta/models/${d.trace?.model ?? "gemini"}:generateContent  (${d.trace?.sent?.length ?? 0} numbered evidence lines)` : "built-in severity rules" });
        break;
      }
      case "plan": out.push({ ...e, who: d.engine === "droid" ? "droid" : "scripted", text: `Fix plan ready: ${d.engine === "droid" && d.rationale ? d.rationale : d.text ?? `${d.commands.length} steps`}`, sub: [d.drastic ? "Major change: needs an analyst's approval" : "Minor change: Batman may apply it after testing", d.note].filter(Boolean).join(". "), query: d.commands.join("  ;  ") }); break;
      case "clone.created": out.push({ ...e, who: "sandbox", text: `Made a copy of ${pc} to test the fix safely`, query: `${machineName()}: copy sandbox → ${d.id}` }); break;
      case "clone.checked": out.push({ ...e, who: "sandbox", text: d.passed ? `Tested the fix on the copy: passed all ${d.checks.length} checks` : `Tested the fix on the copy: failed ${d.checks.filter((c) => !c.passed).length} of ${d.checks.length} checks`, error: !d.passed, checks: d.checks }); break;
      case "decision": out.push({ ...e, who: "batman", text: d.action === "apply" ? "Low risk and the test passed, so Batman is fixing it on its own" : d.action === "await_approval" ? "Major change, so Batman needs an analyst to approve it" : "The fix failed testing on the copy, so Batman will not apply it", error: d.action === "reject" }); break;
      case "human": out.push({ ...e, who: "analyst", text: d.action === "approved" ? `${d.by} approved the fix` : `${d.by} declined the fix. Nothing was changed.` }); break;
      case "applied": out.push({ ...e, who: "batman", text: `Applied the fix to ${pc === "Robin's PC" ? "Robin's real PC" : "the real build runner"}`, query: (d.commands ?? []).join("  ;  ") }); break;
      case "verified": out.push({ ...e, who: "sandbox", text: d.clean ? `Re-checked ${pc}: everything passes` : `Re-checked ${pc}: problems remain`, error: !d.clean, checks: d.health }); break;
      case "failed": out.push({ ...e, who: "batman", text: "Something went wrong running this alert", sub: `Stopped after "${d.after}": ${d.message}`, error: true }); break;
    }
  }
  return out;
}

/* ---------- live data ---------- */

let lastProgress = 0;
let lastSig = "";
async function refreshTrace(id) {
  try {
    const r = await fetch(`/defense/trace/${id}`);
    if (!r.ok) return;
    const trace = await r.json();
    if (!trace) return;
    const t = state.tickets.get(id);
    const sig = `${id}:${trace.steps.length}:${t ? 1 : 0}`;
    if (sig === lastSig) return;
    lastSig = sig;
    lastProgress = Date.now();
    if (t) t.trace = trace; else state.pendingTrace = trace;
    const failed = trace.steps.find((s) => s.kind === "failed");
    if (failed && state.active === id) { state.error = `${failed.data.message}`; state.active = null; }
    render();
  } catch { /* try again next tick */ }
}

setInterval(async () => {
  const id = state.active;
  if (!id) return;
  await refreshTrace(id);
  if (state.active && Date.now() - lastProgress > 60_000) {
    state.error = "No progress from Batman for 60 seconds. Check the terminal running npm run dev, then click Clear demo tickets and try again.";
    state.active = null;
    render();
  }
}, 500);

function onIncident(incident) {
  const known = state.tickets.get(incident.id);
  const ours = incident.id === state.active;
  if (!known && !ours && !DEMO_PREFIXES.some((p) => incident.id.startsWith(p))) return;
  if (!known) {
    const ticket = { incident, trace: ours ? state.pendingTrace : null, history: ours, fresh: true, shown: new Set() };
    if (ours) setTimeout(() => { if (state.view.name === "queue") openTicket(incident.id); }, 1500); // let the room see it land first
    state.tickets.set(incident.id, ticket);
    setTimeout(() => { ticket.fresh = false; }, 3000);
  } else known.incident = incident;
  if (ours && DONE.has(incident.status)) refreshTrace(incident.id).then(() => { if (state.active === incident.id) state.active = null; render(); });
  render();
}

function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/events`);
  ws.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (e.type === "incident.updated") onIncident(e.incident);
  };
  ws.onclose = () => setTimeout(connect, 2000);
}

async function start(tier) {
  state.error = "";
  state.starting = true;
  state.pendingTrace = null;
  render();
  try {
    const r = await fetch(`/defense/scenario/${tier}/start`, { method: "POST" });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || r.statusText);
    state.active = body.incidentId;
    lastProgress = Date.now();
    lastSig = "";
    state.view = { name: "queue" };
  } catch (err) { state.error = String(err.message || err); }
  state.starting = false;
  render();
}

async function decide(action) {
  const id = state.view.id;
  state.acting = true;
  state.active = id;           // keep following the run while the fix is applied
  lastProgress = Date.now();
  render();
  try {
    const r = await fetch(`/defense/demo-${action}/${id}`, { method: "POST" });
    if (!r.ok) throw new Error((await r.json()).error);
  } catch (err) { state.error = String(err.message || err); }
  state.acting = false;
  render();
}

function clearDemo() {
  clearedBefore = Date.now();
  try { localStorage.setItem("batman-demo-cleared", String(clearedBefore)); } catch { /* storage blocked */ }
  state.tickets.clear();
  state.active = null;
  state.error = "";
  state.view = { name: "queue" };
  render();
}

function openTicket(id) { state.view = { name: "ticket", id }; state.techOpen = false; render(); window.scrollTo(0, 0); }

/* ---------- rendering ---------- */

function renderBar() {
  const activeTicket = state.tickets.get(state.active);
  const busy = state.starting || Boolean(state.active);
  let status = "Ready";
  if (state.starting) status = "Starting…";
  else if (activeTicket?.incident.status === "awaiting_approval") status = "Waiting for analyst approval";
  else if (state.active) status = "Batman is working…";
  const i = state.info;
  bar.innerHTML = `
    <b>DEMO</b>
    <button class="low" data-tier="low" ${busy ? "disabled" : ""}>Low tier alert</button>
    <button class="high" data-tier="high" ${busy ? "disabled" : ""}>High tier alert</button>
    <button class="agent" data-tier="agent" ${busy ? "disabled" : ""}>AI agent alert</button>
    <button class="ghost" id="clear" ${state.starting ? "disabled" : ""}>Clear demo tickets</button>
    <span class="state" aria-live="polite">${esc(status)}</span>
    <span class="chips">${i ? `
      <span class="chip">Machine: ${i.backend === "daytona" ? "Daytona" : "local sandbox"}</span>
      <span class="chip">AI: ${i.investigator === "gemini" ? "Gemini" : "built-in rules"}</span>` : ""}<a href="explain/" style="color:#c7cbff;margin-left:6px;white-space:nowrap">How it works →</a></span>`;
  bar.querySelectorAll("[data-tier]").forEach((b) => (b.onclick = () => start(b.dataset.tier)));
  bar.querySelector("#clear").onclick = clearDemo;
}

const priorityCell = (inc) => (declared(inc) ? `<span class="p-${inc.severity}">${PRIORITY[inc.severity]}</span>` : `<span class="p-undeclared">Undeclared</span>`);

function demoRows() {
  return [...state.tickets.entries()]
    .sort((a, b) => (b[1].incident.createdAt ?? 0) - (a[1].incident.createdAt ?? 0))
    .map(([id, t]) => {
      const inc = t.incident;
      const [label, cls] = STATUS[inc.status] ?? [inc.status, "s-progress"];
      return `<tr class="${t.fresh ? "fresh" : ""}">
        <td><a data-open="${esc(id)}">${ticketNo(id)}</a></td>
        <td><span class="pill ${cls}">${esc(label)}</span></td>
        <td class="title"><a data-open="${esc(id)}">${esc(inc.title)}</a><span class="ai-tag">AI</span></td>
        <td><a>${DEPT}</a></td>
        <td>${priorityCell(inc)}</td>
        <td class="muted hide-sm">${relative(inc.updatedAt ?? inc.createdAt ?? Date.now())}</td>
      </tr>`;
    }).join("");
}

function renderQueue() {
  const filler = FILLER.map((f) => `<tr>
      <td><a>${f.no}</a></td>
      <td><span class="pill ${f.status[1]}">${esc(f.status[0])}</span></td>
      <td class="title"><a>${esc(f.title)}</a></td>
      <td><a>${DEPT}</a></td>
      <td><span class="p-${f.priority}">${PRIORITY[f.priority]}</span></td>
      <td class="muted hide-sm">${relative(f.modified)}</td>
    </tr>`).join("");
  const count = FILLER.length + state.tickets.size;
  app.innerHTML = `
    <section class="card">
      <div class="queue-head"><h1>Active Tickets (Dashboard Filter)</h1>
        <div class="toolbar"><span>☰ Filters (1)</span><span>${count} tickets</span><span title="Live">⟳</span></div></div>
      ${state.error ? `<p class="section err" style="color:var(--bad)">${esc(state.error)}</p>` : ""}
      <div style="overflow-x:auto"><table>
        <thead><tr><th>ID <i>⇅</i></th><th>Status <i>⇅</i></th><th>Title <i>⇅</i></th><th>Acct/Dept <i>⇅</i></th><th>Priority <i>⇅</i></th><th class="hide-sm">Modified <i>⇅</i></th></tr></thead>
        <tbody>${demoRows()}${filler}</tbody>
      </table></div>
    </section>`;
  app.querySelectorAll("[data-open]").forEach((a) => (a.onclick = () => openTicket(a.dataset.open)));
}

function renderFeed(t) {
  if (!t.history) return `<p class="empty">Activity for this ticket was recorded before this page was opened.</p>`;
  const feed = feedFrom(t.trace, t.incident);
  if (!feed.length) return `<p class="empty">Waiting for Batman…</p>`;
  return `<ol class="feed" aria-live="polite">${[...feed].reverse().map((f) => {
    const [who, cls] = WHO[f.who] ?? ["System", "w-sim"];
    const enter = !t.shown.has(f.key);
    t.shown.add(f.key);
    return `<li class="${enter ? "enter" : ""}"><time>${timeOf(f.ts)}</time><span class="who ${cls}">${esc(who)}</span>
      <div class="what ${f.error ? "err" : ""}">${esc(f.text)}${f.sub ? `<small>${esc(f.sub)}</small>` : ""}
        ${f.query ? `<code class="query">${esc(f.query)}</code>` : ""}
        ${f.checks ? `<ul class="checks">${f.checks.map((c) => `<li class="${c.passed ? "pass" : "fail"}">${esc(c.name)}</li>`).join("")}</ul>` : ""}</div></li>`;
  }).join("")}</ol>
  <p class="footnote">* Placeholder: answered from the demo's local data instead of the live service.</p>`;
}

function systemsState(t) {
  const feed = feedFrom(t.trace, t.incident);
  const used = new Set(feed.map((f) => WHO[f.who]?.[2]).filter(Boolean));
  const last = WHO[feed.at(-1)?.who]?.[2];
  const running = t.incident.id === state.active;
  const tag = { daytona: state.info?.backend === "daytona" ? "" : "local stand-in", intel: "placeholder", gemini: state.info?.investigator === "gemini" ? "" : "not configured", droid: state.info?.planner === "droid" ? "" : "placeholder", photon: state.info?.photon === "live" ? "" : "demo mode", elevenlabs: state.info?.voice === "live" ? "" : "demo mode" };
  return `<ul class="systems">${SYSTEMS.map((s) => {
    const cls = running && last === s.key ? "busy" : used.has(s.key) ? "done" : "";
    const role = s.key === "daytona" && isAgent(t.incident) ? "The build runner and the test copy" : s.role;
    return `<li class="${cls}"><span class="dot"></span><span><b>${esc(s.name)}</b><br><span style="color:var(--muted)">${esc(role)}</span></span><span class="tag">${esc(tag[s.key] ?? "")}</span></li>`;
  }).join("")}</ul>`;
}

function banner(t) {
  const inc = t.incident;
  const plan = t.trace?.steps.find((s) => s.kind === "plan")?.data;
  if (inc.status === "awaiting_approval") {
    const n = inc.proposedFix?.cloneCheck?.checks.length ?? 0;
    return `<div class="approval" role="region" aria-label="Approval needed">
      <h3>Batman needs your approval</h3>
      <p><b>Proposed:</b> ${esc(plan?.text ?? "apply the fix")}. It passed all ${n} checks on a test copy, but it's a major change, so an analyst has to approve it before it touches the real system.</p>
      <button class="yes" id="approve" ${state.acting ? "disabled" : ""}>Approve</button>
      <button class="no" id="reject" ${state.acting ? "disabled" : ""}>Reject</button>
    </div>`;
  }
  if (inc.status === "resolved") return `<div class="outcome ok">Resolved. The fix was applied and ${isAgent(inc) ? "the build runner" : "Robin's PC"} was re-checked: everything passes.</div>`;
  if (inc.status === "fix_rejected") {
    const declined = t.trace?.steps.some((s) => s.kind === "human" && s.data.action === "rejected");
    return `<div class="outcome bad">Closed without changes: ${declined ? "the analyst declined the fix." : "the fix failed testing on the copy."}</div>`;
  }
  return "";
}

function renderTicket() {
  const t = state.tickets.get(state.view.id);
  if (!t) { state.view = { name: "queue" }; return renderQueue(); }
  const inc = t.incident;
  const [label, cls] = STATUS[inc.status] ?? [inc.status, "s-progress"];
  const investigating = !declared(inc);
  const fix = inc.proposedFix;
  app.innerHTML = `
    <div class="crumb"><a id="back">← Back to Active Tickets</a></div>
    <section class="card ticket-head">
      <div><div class="num">Ticket ${ticketNo(inc.id)} · Opened ${timeOf(inc.createdAt ?? Date.now())}</div><h1>${esc(inc.title)}</h1></div>
      <span class="pill ${cls}">${esc(label)}</span>
    </section>
    <div class="ticket-grid">
      <section class="card">
        <div style="padding-top:18px">${banner(t)}</div>
        <div class="section"><h2>What happened</h2>
          <p class="lead">${investigating ? "Batman is looking into this alert." : esc(inc.businessSummary)}</p></div>
        <div class="section"><h2>Activity</h2>${renderFeed(t)}</div>
        ${investigating ? "" : `<div class="section"><details class="tech" ${state.techOpen ? "open" : ""}><summary>Technical details for analysts</summary>
          <p>${esc(inc.technicalSummary)}</p>
          ${inc.evidence.length ? `<b>Evidence</b><ul class="evidence">${inc.evidence.map((e) => `<li><code>${esc(e)}</code></li>`).join("")}</ul>` : ""}
          ${fix?.commands?.length ? `<b>Fix steps</b><pre>${esc(fix.commands.join("\n"))}</pre>` : ""}
        </details></div>`}
      </section>
      <aside>
        <section class="card section"><h2>Details</h2><dl class="props">
          <dt>Status</dt><dd><span class="pill ${cls}">${esc(label)}</span></dd>
          <dt>Priority</dt><dd>${investigating ? `<span class="p-undeclared">Undeclared</span>` : `<span class="p-${inc.severity}">${PRIORITY[inc.severity]}</span> · ${pct(inc.confidence)} confident`}</dd>
          <dt>Acct/Dept</dt><dd><a>${DEPT}</a></dd>
          <dt>User</dt><dd>${isAgent(inc) ? "agent-ci-7 (AI coding agent)" : "robin.business@harvard.edu"}</dd>
          <dt>Device</dt><dd>${isAgent(inc) ? "BUILD-RUNNER-02" : "ROBIN-PC"}</dd>
          <dt>Assigned to</dt><dd>Batman (AI agent)</dd>
          ${fix?.approvedBy ? `<dt>Approved by</dt><dd>${esc(fix.approvedBy)}</dd>` : ""}
          <dt>Modified</dt><dd>${relative(inc.updatedAt ?? Date.now())}</dd>
        </dl></section>
        <section class="card section" style="margin-top:20px"><h2>Systems Batman used</h2>${systemsState(t)}</section>
      </aside>
    </div>`;
  app.querySelector("#back").onclick = () => { state.view = { name: "queue" }; render(); };
  app.querySelector("#approve")?.addEventListener("click", () => decide("approve"));
  app.querySelector("#reject")?.addEventListener("click", () => decide("reject"));
  app.querySelector("details.tech")?.addEventListener("toggle", (ev) => { state.techOpen = ev.target.open; });
}

function render() {
  renderBar();
  if (state.view.name === "ticket") renderTicket(); else renderQueue();
}

async function boot() {
  render();
  try { state.info = await (await fetch("/defense/info")).json(); } catch { /* chips stay empty */ }
  try {
    const incidents = await (await fetch("/api/incidents")).json();
    for (const inc of incidents) {
      if (DEMO_PREFIXES.some((p) => inc.id.startsWith(p)) && (inc.createdAt ?? 0) > clearedBefore) {
        const t = { incident: inc, trace: null, history: false, fresh: false, shown: new Set() };
        state.tickets.set(inc.id, t);
        fetch(`/defense/trace/${inc.id}`).then((r) => (r.ok ? r.json() : null)).then((tr) => { if (tr) { t.trace = tr; t.history = true; render(); } }).catch(() => {});
      }
    }
  } catch { /* queue shows filler only */ }
  render();
  connect();
  setInterval(() => { if (state.view.name === "queue") render(); }, 30_000);
}

boot();
