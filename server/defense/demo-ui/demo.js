// Judge-facing demo (Person 2). A plain ticketing view driven by the real defense engine's live events.
const app = document.querySelector("#app");
const bar = document.querySelector("#presenter");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const DONE = new Set(["resolved", "fix_rejected"]);
const IGNORED_ACTORS = new Set(["voice", "verification", "demo", "console"]);
const DEMO_PREFIXES = ["inc-low-", "inc-high-"];

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
  { no: "20812997", status: ["New", "s-new"], title: "VPN access request for new contractor", requestor: "Dana Whitfield", dept: "Information Technology Services (ITS)", group: "ITS - CSOC - All", priority: "low", modified: ago(14) },
  { no: "20813639", status: ["New", "s-new"], title: "Phishing email reported: \"Payroll update required\"", requestor: "Marcus Lee", dept: "Human Resources", group: "ITS - CSOC - FTE", priority: "medium", modified: ago(26) },
  { no: "20814728", status: ["In Progress", "s-progress"], title: "Review admin consent request for a calendar app", requestor: "Priya Shah", dept: "Information Technology Services (ITS)", group: "ITS - Technical Operations", priority: "low", modified: ago(41) },
  { no: "20814102", status: ["Waiting on Customer", "s-wait"], title: "Locked out after password reset", requestor: "Tom Alvarez", dept: "Athletics", group: "ITS - Service Desk", priority: "low", modified: ago(58) },
  { no: "20813877", status: ["In Progress", "s-progress"], title: "Replace lost MFA device", requestor: "Grace Kim", dept: "Finance", group: "ITS - Service Desk", priority: "medium", modified: ago(73) },
  { no: "20812560", status: ["New", "s-new"], title: "Shared drive access for Marketing interns", requestor: "Leo Martins", dept: "Marketing", group: "ITS - Service Desk", priority: "low", modified: ago(96) },
  { no: "20811934", status: ["In Progress", "s-progress"], title: "Laptop slow after security update", requestor: "Ana Ruiz", dept: "Admissions", group: "ITS - Desktop Support", priority: "low", modified: ago(130) },
];

const SYSTEMS = [
  { key: "daytona", name: "Daytona", role: "Machine and test copy" },
  { key: "gemini", name: "Gemini", role: "AI investigator" },
  { key: "droid", name: "Factory Droid", role: "Fix planner" },
  { key: "photon", name: "Photon", role: "Text the analyst" },
  { key: "elevenlabs", name: "ElevenLabs", role: "Phone briefing" },
];
const WHO = {
  batman: ["Batman", "w-batman"], daytona: ["Daytona", "w-daytona"], gemini: ["Gemini", "w-gemini"], droid: ["Droid", "w-droid"],
  photon: ["Photon", "w-photon"], elevenlabs: ["ElevenLabs", "w-elevenlabs"], analyst: ["Analyst", "w-analyst"], sim: ["Demo", "w-sim"],
};

let clearedBefore = 0;
try { clearedBefore = Number(localStorage.getItem("batman-demo-cleared") || 0); } catch { /* storage blocked */ }

const state = {
  info: null,
  view: { name: "queue" },
  tickets: new Map(),     // id -> { incident, feed: [], history: bool, fresh: bool }
  active: null,           // incident id of the run this page started
  pending: [],            // feed entries that arrive before the ticket exists
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
  const h = Math.floor(m / 60);
  return `${h} hr ago`;
}
const pct = (n) => `${Math.round(Number(n) * 100)}%`;

/** Turns an engine event into one plain-English line for the activity feed. */
function describe(e) {
  const d = e.detail ?? "";
  switch (e.action) {
    case "scenario.start": return { who: "daytona", text: "Connected to the affected machine", sub: `Sandbox ${(/machine (\w+)/.exec(d) || [])[1] ?? ""}`.trim() };
    case "sim.virus": return { who: "sim", text: "Simulated threat started on the machine", sub: "Harmless script written for this demo" };
    case "query.processes": return { who: "batman", text: `Checked running programs: ${d}` };
    case "query.network": return { who: "batman", text: `Checked network activity: ${d}` };
    case "query.schedule": return { who: "batman", text: `Checked scheduled tasks: ${d}` };
    case "query.health": return { who: "batman", text: `Checked the app's health: ${d}` };
    case "investigation.done": {
      const m = /severity (\w+), confidence ([\d.]+), (\d+) evidence/.exec(d) || [];
      const viaGemini = d.startsWith("gemini");
      return {
        who: viaGemini ? "gemini" : "batman",
        text: `${viaGemini ? "AI reviewed the evidence" : "Reviewed the evidence with built-in rules"}: ${PRIORITY[m[1]] ?? "?"} priority, ${m[2] ? pct(m[2]) : "?"} confident`,
        sub: viaGemini ? `${m[3] ?? "?"} pieces of evidence cited` : (d.includes("gemini failed") ? "AI service was unavailable, so Batman used its built-in rules" : `${m[3] ?? "?"} pieces of evidence cited`),
      };
    }
    case "voice.briefing_ready": return { who: "elevenlabs", text: "Phone briefing updated", sub: "The CEO and the analyst can call in for a summary at their level (placeholder)" };
    case "fix.planned": {
      const m = /: (\d+) steps?, (major|minor) change/.exec(d) || [];
      return { who: "droid", text: `Fix plan ready: ${m[1] ?? "?"} step${m[1] === "1" ? "" : "s"}, ${m[2] ?? "?"} change`, sub: "Scripted plan standing in for Factory Droid (placeholder)" };
    }
    case "clone.created": return { who: "daytona", text: "Made a copy of the machine to test the fix safely" };
    case "clone.checked": {
      const left = /still present: (.*?)(; failed:|$)/.exec(d)?.[1];
      return { who: "daytona", kind: "clone", sub: left ? `Still on the copy after the fix: ${left}` : undefined };
    }
    case "decision": {
      if (d.startsWith("apply")) return { who: "batman", text: "Low risk and the test passed, so Batman is fixing it on its own" };
      if (d.startsWith("await_approval")) return { who: "batman", text: "This fix makes major changes, so Batman is asking an analyst to approve it" };
      return { who: "batman", text: "The fix failed testing on the copy, so Batman will not apply it", error: true };
    }
    case "approval.granted": return { who: "analyst", text: `${e.actor} approved the fix` };
    case "approval.rejected": return { who: "analyst", text: `${e.actor} declined the fix. Nothing on the machine was changed.` };
    case "fix.apply": return { who: "batman", text: "Applying the fix to the real machine" };
    case "fix.verify": return { who: "daytona", text: d.includes("clean") ? "Re-checked the real machine: it is clean" : "Re-checked the real machine: problems remain", error: !d.includes("clean") };
    case "fix.apply_failed": return { who: "batman", text: "Applying the fix failed", sub: d, error: true };
    case "scenario.failed": return { who: "batman", text: "Something went wrong running this alert", sub: d, error: true };
    default: return null;
  }
}

// If the engine goes quiet mid-run, say so instead of spinning forever.
let lastProgress = 0;
setInterval(() => {
  if (state.active && Date.now() - lastProgress > 60_000) {
    state.error = "No progress from Batman for 60 seconds. Check the terminal running npm run dev for an error, then click Clear demo tickets and try again.";
    state.active = null;
    render();
  }
}, 5_000);

function addEntry(entry) {
  entry.ts = entry.ts ?? Date.now();
  const ticket = state.tickets.get(state.active);
  if (ticket) ticket.feed.push(entry); else state.pending.push(entry);
}

function onIncident(incident) {
  const known = state.tickets.get(incident.id);
  const ours = incident.id === state.active;
  if (!known && !ours && !DEMO_PREFIXES.some((p) => incident.id.startsWith(p))) return;
  if (!known) {
    const ticket = { incident, feed: [], history: true, fresh: true };
    if (ours) {
      ticket.feed.push(...state.pending.splice(0));
      ticket.feed.push({ ts: Date.now(), who: "batman", text: `Alert raised. Ticket ${ticketNo(incident.id)} opened and assigned to Batman.` });
      // Let the room see the ticket land in the queue, then open it.
      setTimeout(() => { if (state.view.name === "queue") openTicket(incident.id); }, 1500);
    } else ticket.history = false;
    state.tickets.set(incident.id, ticket);
    setTimeout(() => { ticket.fresh = false; }, 3000);
  } else known.incident = incident;
  if (ours && DONE.has(incident.status)) state.active = null;
  render();
}

function connect() {
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/events`);
  ws.onmessage = (m) => {
    const e = JSON.parse(m.data);
    if (state.active) lastProgress = Date.now();
    if (e.type === "incident.updated") return onIncident(e.incident);
    if (!state.active) return;
    if (e.type === "audit" && !IGNORED_ACTORS.has(e.actor)) {
      const entry = describe(e);
      if (!entry) return;
      addEntry({ ...entry, ts: e.ts });
      if (e.action === "scenario.failed") { state.active = null; state.error = e.detail; }
      render();
    } else if (e.type === "sms.sent" && !/verification code/i.test(e.body)) {
      const about = /APPROVE/.test(e.body) ? "Asked them to approve the fix" : /REJECTED/.test(e.body) ? "Told them the fix was rejected" : /resolved/.test(e.body) ? "Told them the ticket is resolved" : "Sent an update";
      addEntry({ who: "photon", text: "Texted the on-call analyst", sub: `${about} (demo mode: no real text is sent)` });
      render();
    }
  };
  ws.onclose = () => setTimeout(connect, 2000);
}

async function start(tier) {
  state.error = "";
  state.starting = true;
  render();
  try {
    const r = await fetch(`/defense/scenario/${tier}/start`, { method: "POST" });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || r.statusText);
    state.active = body.incidentId;
    lastProgress = Date.now();
    state.pending = [];
    state.view = { name: "queue" };
  } catch (err) { state.error = String(err.message || err); }
  state.starting = false;
  render();
}

async function decide(action) {
  const id = state.view.id;
  state.acting = true;
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
  state.pending = [];
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
    <button class="ghost" id="clear" ${state.starting ? "disabled" : ""}>Clear demo tickets</button>
    <span class="state" aria-live="polite">${esc(status)}</span>
    <span class="chips">${i ? `
      <span class="chip">Machine: ${i.backend === "daytona" ? "Daytona" : "local sandbox"}</span>
      <span class="chip">AI: ${i.investigator === "gemini" ? "Gemini" : "built-in rules"}</span>
      <span class="chip">Fix planner: Droid placeholder</span>` : ""}</span>`;
  bar.querySelectorAll("[data-tier]").forEach((b) => (b.onclick = () => start(b.dataset.tier)));
  bar.querySelector("#clear").onclick = clearDemo;
}

function demoRows() {
  return [...state.tickets.entries()]
    .sort((a, b) => (b[1].incident.createdAt ?? 0) - (a[1].incident.createdAt ?? 0))
    .map(([id, t]) => {
      const inc = t.incident;
      const [label, cls] = STATUS[inc.status] ?? [inc.status, "s-progress"];
      const prio = inc.status === "detected" ? `<span class="muted">Pending</span>` : `<span class="p-${inc.severity}">${PRIORITY[inc.severity]}</span>`;
      return `<tr class="${t.fresh ? "fresh" : ""}">
        <td><a data-open="${esc(id)}">${ticketNo(id)}</a></td>
        <td><span class="pill ${cls}">${esc(label)}</span></td>
        <td class="title"><a data-open="${esc(id)}">${esc(inc.title)}</a><span class="ai-tag">AI</span></td>
        <td>Endpoint monitoring</td>
        <td><a>Finance - Payroll</a></td>
        <td>ITS - CSOC - Batman AI</td>
        <td>${prio}</td>
        <td class="muted hide-sm">${relative(inc.updatedAt ?? inc.createdAt ?? Date.now())}</td>
      </tr>`;
    }).join("");
}

function renderQueue() {
  const filler = FILLER.map((f) => `<tr>
      <td><a>${f.no}</a></td>
      <td><span class="pill ${f.status[1]}">${esc(f.status[0])}</span></td>
      <td class="title"><a>${esc(f.title)}</a></td>
      <td>${esc(f.requestor)}</td>
      <td><a>${esc(f.dept)}</a></td>
      <td>${esc(f.group)}</td>
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
        <thead><tr><th>ID <i>⇅</i></th><th>Status <i>⇅</i></th><th>Title <i>⇅</i></th><th>Requestor <i>⇅</i></th><th>Acct/Dept <i>⇅</i></th><th>Resp Group <i>⇅</i></th><th>Priority <i>⇅</i></th><th class="hide-sm">Modified <i>⇅</i></th></tr></thead>
        <tbody>${demoRows()}${filler}</tbody>
      </table></div>
    </section>`;
  app.querySelectorAll("[data-open]").forEach((a) => (a.onclick = () => openTicket(a.dataset.open)));
}

function cloneEntry(inc) {
  const cc = inc.proposedFix?.cloneCheck;
  if (!cc) return { text: "Tested the fix on the copy" };
  const passed = cc.checks.filter((c) => c.passed).length;
  return {
    text: cc.passed ? `Tested the fix on the copy: passed all ${cc.checks.length} checks` : `Tested the fix on the copy: failed ${cc.checks.length - passed} of ${cc.checks.length} checks`,
    error: !cc.passed,
    html: `<ul class="checks">${cc.checks.map((c) => `<li class="${c.passed ? "pass" : "fail"}">${esc(c.name)}</li>`).join("")}</ul>`,
  };
}

function renderFeed(t) {
  if (!t.history) return `<p class="empty">Activity for this ticket was recorded before this page was opened.</p>`;
  if (!t.feed.length) return `<p class="empty">Waiting for Batman…</p>`;
  return `<ol class="feed" aria-live="polite">${[...t.feed].reverse().map((f) => {
    const resolved = f.kind === "clone" ? { ...f, ...cloneEntry(t.incident) } : f;
    const [who, cls] = WHO[resolved.who] ?? ["System", "w-sim"];
    const enter = !f.shown;
    f.shown = true;
    return `<li class="${enter ? "enter" : ""}"><time>${timeOf(resolved.ts)}</time><span class="who ${cls}">${esc(who)}</span>
      <div class="what ${resolved.error ? "err" : ""}">${esc(resolved.text)}${resolved.sub ? `<small>${esc(resolved.sub)}</small>` : ""}${resolved.html ?? ""}</div></li>`;
  }).join("")}</ol>`;
}

function systemsState(t) {
  const used = new Set(t.feed.map((f) => f.who));
  const last = t.feed.at(-1)?.who;
  const running = t.incident.id === state.active;
  const tag = { daytona: state.info?.backend === "daytona" ? "" : "local stand-in", gemini: state.info?.investigator === "gemini" ? "" : "not configured", droid: "placeholder", photon: "demo mode", elevenlabs: "placeholder" };
  return `<ul class="systems">${SYSTEMS.map((s) => {
    const cls = running && last === s.key ? "busy" : used.has(s.key) ? "done" : "";
    return `<li class="${cls}"><span class="dot"></span><span><b>${esc(s.name)}</b><br><span class="muted" style="color:var(--muted)">${esc(s.role)}</span></span><span class="tag">${esc(tag[s.key])}</span></li>`;
  }).join("")}</ul>`;
}

function banner(t) {
  const inc = t.incident;
  if (inc.status === "awaiting_approval") {
    const n = inc.proposedFix?.cloneCheck?.checks.length ?? 0;
    return `<div class="approval" role="region" aria-label="Approval needed">
      <h3>Batman needs your approval</h3>
      <p>The fix passed all ${n} checks on a test copy of this machine. It stops a running program and restores changed files, so an analyst has to approve it before it touches the real machine.</p>
      <button class="yes" id="approve" ${state.acting ? "disabled" : ""}>Approve fix</button>
      <button class="no" id="reject" ${state.acting ? "disabled" : ""}>Reject</button>
    </div>`;
  }
  if (inc.status === "resolved") return `<div class="outcome ok">Fixed and verified. The machine was re-checked after the fix and is clean.</div>`;
  if (inc.status === "fix_rejected") {
    const declined = t.feed.some((f) => /declined the fix/.test(f.text ?? ""));
    return `<div class="outcome bad">Closed without changes: ${declined ? "the analyst declined the fix." : "the fix failed testing on the copy."}</div>`;
  }
  return "";
}

function renderTicket() {
  const t = state.tickets.get(state.view.id);
  if (!t) { state.view = { name: "queue" }; return renderQueue(); }
  const inc = t.incident;
  const [label, cls] = STATUS[inc.status] ?? [inc.status, "s-progress"];
  const investigating = inc.status === "detected" || (inc.status === "investigating" && !inc.evidence.length);
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
          <dt>Priority</dt><dd>${investigating ? "Pending" : `<span class="p-${inc.severity}">${PRIORITY[inc.severity]}</span> · ${pct(inc.confidence)} confident`}</dd>
          <dt>Requestor</dt><dd>Endpoint monitoring</dd>
          <dt>Acct/Dept</dt><dd><a>Finance - Payroll</a></dd>
          <dt>Device</dt><dd>acme-payroll-01</dd>
          <dt>Resp Group</dt><dd>ITS - CSOC - Batman AI</dd>
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
        state.tickets.set(inc.id, { incident: inc, feed: [], history: false, fresh: false });
      }
    }
  } catch { /* queue shows filler only */ }
  render();
  connect();
  setInterval(() => { if (state.view.name === "queue") render(); }, 30_000);
}

boot();
