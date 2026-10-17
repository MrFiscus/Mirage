// "How it works" (Person 2). The real engine runs at full speed; this page replays its recorded steps one Next at a time.
const app = document.querySelector("#app");
const bar = document.querySelector("#presenter");
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
const PRIORITY = { low: "Low", medium: "Medium", high: "High" };
const STATUS = {
  detected: ["New", "s-new"], investigating: ["In Progress", "s-progress"], testing_fix: ["Testing Fix", "s-progress"],
  awaiting_approval: ["Waiting for Approval", "s-wait"], resolved: ["Resolved", "s-ok"], fix_rejected: ["Closed - Not Fixed", "s-bad"],
};
const WHO = {
  batman: ["Batman", "w-batman"], daytona: ["Daytona", "w-daytona"], gemini: ["Gemini", "w-gemini"], rules: ["Rules", "w-batman"],
  edr: ["Endpoint (EDR)", "w-daytona"], idp: ["Identity", "w-daytona"], virustotal: ["VirusTotal (placeholder)", "w-elevenlabs"],
  ipinfo: ["IPinfo (placeholder)", "w-elevenlabs"], abuseipdb: ["AbuseIPDB (placeholder)", "w-elevenlabs"], photon: ["Photon", "w-photon"], elevenlabs: ["ElevenLabs", "w-photon"],
  aiagent: ["AI agent (simulated)", "w-sim"], harness: ["Agent harness", "w-daytona"], sensor: ["Decoy sensor", "w-daytona"],
  droid: ["Factory Droid", "w-droid"], scripted: ["Scripted plan (Droid placeholder)", "w-droid"], analyst: ["Analyst", "w-analyst"], sim: ["Demo", "w-sim"], code: ["Guardrail (code)", "w-elevenlabs"],
};
const ms = (n) => (n == null ? "" : n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`);
const secs = (n) => `${(n / 1000).toFixed(2)} s`;

const state = { info: null, tier: null, id: null, trace: null, incident: null, shown: 0, error: "", acting: false, poll: null };

/* ---------- turning the recorded trace into slides ---------- */

function slides() {
  const t = state.trace;
  if (!t) return [];
  const out = [];
  const at = (s) => s.at - t.startedAt;
  for (const s of t.steps) {
    const d = s.data;
    switch (s.kind) {
      case "machine.created": out.push({ key: "machine", who: "daytona", title: d.role === "pc" ? "Batman connects to Robin's PC" : d.role === "build runner" ? "Batman connects to the build runner where the AI agent works" : "Batman connects to the company machine", at: at(s), ms: s.ms, d }); break;
      case "threat.started": out.push({ key: "threat", who: "sim", title: d.text ? "The demo sets up the alert" : "A simulated threat runs on it", at: at(s), ms: s.ms, d }); break;
      case "agent": out.push({ key: `agent-${s.at}`, kind: "agent", who: d.who, title: d.text, at: at(s), ms: s.ms, d }); break;
      case "queries": out.push({ key: "queries", who: "batman", title: "Batman inspects the machine with read-only queries", at: at(s), ms: s.ms, d }); break;
      case "alert": out.push({ key: "alert", who: "batman", title: "Alert raised: a ticket is opened", at: at(s), d }); break;
      case "investigation": {
        const viaGemini = String(d.engine ?? "").startsWith("gemini") || Boolean(d.trace?.model);
        if (viaGemini) {
          out.push({ key: "sent", who: "gemini", title: "The evidence is sent to Gemini", at: at(s), d });
          out.push({ key: "answer", who: "gemini", title: "Gemini answers", at: at(s), ms: s.ms, d });
        }
        out.push({ key: "guard", who: viaGemini ? "code" : "rules", title: viaGemini ? "Guardrails check Gemini's answer" : "Built-in rules set the severity", at: at(s), d });
        break;
      }
      case "plan": out.push({ key: "plan", who: d.engine === "droid" ? "droid" : "scripted", title: "A fix is planned", at: at(s), ms: s.ms, d }); break;
      case "clone.created": out.push({ key: "clone", who: "daytona", title: "A copy of the machine is made to test the fix", at: at(s), ms: s.ms, d }); break;
      case "clone.checked": out.push({ key: "checked", who: "daytona", title: "The fix runs on the copy, then health checks", at: at(s), ms: s.ms, d }); break;
      case "decision": out.push({ key: "decision", who: "batman", title: "Batman decides what happens next", at: at(s), d }); break;
      case "human": out.push({ key: "human", who: "analyst", title: d.action === "approved" ? "The analyst approves the fix" : "The analyst rejects the fix", at: at(s), d }); break;
      case "applied": out.push({ key: "applied", who: "batman", title: "The fix is applied to the real machine", at: at(s), ms: s.ms, d }); break;
      case "verified": out.push({ key: "verified", who: "daytona", title: "The real machine is re-checked", at: at(s), ms: s.ms, d }); break;
      case "failed": out.push({ key: "failed", who: "batman", title: "This run stopped with an error", at: at(s), d }); break;
    }
  }
  // While the engine waits for a person, show an approval slide with buttons.
  const decision = t.steps.find((s) => s.kind === "decision");
  const human = t.steps.find((s) => s.kind === "human");
  if (decision?.data.action === "await_approval" && !human) out.push({ key: "approve", who: "analyst", title: "Waiting for an analyst", at: at(decision), d: {} });
  if (finished() && !t.steps.some((s) => s.kind === "failed")) out.push({ key: "summary", who: "batman", title: "How long that really took", d: {} });
  return out;
}

function finished() {
  const k = new Map((state.trace?.steps ?? []).map((s) => [s.kind, s]));
  return k.has("verified") || k.has("failed") || k.get("decision")?.data.action === "reject" || k.get("human")?.data.action === "rejected";
}

/* ---------- slide bodies ---------- */

function body(sl) {
  const d = sl.d;
  switch (sl.key) {
    case "machine": return d.role === "pc"
      ? `<p class="why">A ${d.backend === "daytona" ? "real Daytona cloud sandbox" : "local sandbox"} plays <b>ROBIN-PC</b>, the work computer of robin.business@harvard.edu: their Business folder, browser downloads, endpoint and sign-in logs.</p>
      <dl class="kv"><dt>Machine id</dt><dd><code>${esc(d.id)}</code></dd><dt>Where</dt><dd>${d.backend === "daytona" ? "Daytona (cloud)" : "Local sandbox"}</dd></dl>`
      : `<p class="why">A ${d.backend === "daytona" ? "real Daytona cloud sandbox" : "local sandbox"} stands in for the company's payroll server, <b>acme-payroll-01</b>. It runs a small app with its own tests.</p>
      <dl class="kv"><dt>Machine id</dt><dd><code>${esc(d.id)}</code></dd><dt>Where</dt><dd>${d.backend === "daytona" ? "Daytona (cloud)" : "Local sandbox"}</dd></dl>`;
    case "threat": if (d.text) return `<p class="why">${esc(d.text)}.</p><p class="note">A harmless setup script written for this demo. No real malware and nothing leaves the machine.</p>`;
      return d.tier === "low"
      ? `<p class="why">A harmless script written for this demo adds a <b>scheduled task IT never approved</b>. Nothing runs, nothing connects out, no files change.</p>`
      : `<p class="why">A harmless script written for this demo <b>starts an unknown program</b>, writes a <b>fake connection to an outside address</b> into the network log, <b>changes an app file</b> and <b>adds a scheduled task</b>.</p><p class="note">No real malware. The "connection" is a line in a log; nothing leaves the machine.</p>`;
    case "queries": return `<p class="why">Four fixed, read-only commands. Batman can't run anything else here, and whatever the logs say is treated as data, never as instructions.</p>
      <table class="q"><thead><tr><th>Check</th><th>Exact command</th><th>Found</th></tr></thead><tbody>
      ${d.queries.map((q) => `<tr><td><b>${esc(q.name)}</b></td><td><code>${esc(q.command)}</code></td><td>${q.found.length ? `<span class="found">${q.found.length} problem${q.found.length > 1 ? "s" : ""}</span><br><code>${q.found.map(esc).join("<br>")}</code>` : `<span class="nothing">Nothing unusual</span>`}</td></tr>`).join("")}
      </tbody></table>`;
    default:
      if (sl.kind === "agent") return `<p class="why">The exact query Batman ran${/placeholder/.test(d.query) ? " (answered from the demo's local intel list instead of the live service)" : ", read-only"}:</p>
        <pre class="code">${esc(d.query)}</pre>
        ${d.result?.length ? `<p class="note" style="margin-top:14px">What came back:</p><pre class="code datablock">${d.result.map(esc).join("\n")}</pre>` : ""}`;
      return "";
    case "alert": return `<p class="why">At least one check found something, so Batman opens a ticket in the queue and assigns it to itself.</p><p class="big">${esc(d.title)}</p>`;
    case "sent": {
      const sent = d.trace?.sent ?? [];
      return `<p class="why">Batman sends Gemini <b>only these ${sent.length} numbered lines</b>, marked as untrusted data. Gemini can cite them by number but can't invent new ones.</p>
        <pre class="code datablock">${sent.map((l, i) => `[${i}] ${esc(l)}`).join("\n")}</pre>
        <p class="note">Model: ${esc(d.trace?.model ?? "")}. Also sent: the severity policy and the rules (no "breach" without proof, don't guess from names, only mention what is in the evidence).</p>`;
    }
    case "answer": {
      const r = d.trace?.raw;
      if (!r) return `<p class="why">No usable answer came back.</p><div class="verdict bad">${esc(d.trace?.guard ?? "")}</div>`;
      const cited = Array.isArray(r.cited) ? r.cited.map((i) => `[${i}]`).join(" ") : "none";
      return `<p class="why">Gemini's answer, exactly as it came back, before any checks.</p>
        <dl class="kv">
          <dt>Severity</dt><dd class="big">${esc(PRIORITY[r.severity] ?? r.severity)}</dd>
          <dt>Confidence</dt><dd>${Number.isFinite(Number(r.confidence)) ? Math.round(Number(r.confidence) * 100) + "%" : esc(r.confidence)}</dd>
          <dt>Evidence cited</dt><dd><code>${esc(cited)}</code></dd>
          <dt>For the CEO</dt><dd>${esc(r.businessSummary)}</dd>
          <dt>For the analyst</dt><dd>${esc(r.technicalSummary)}</dd>
        </dl>`;
    }
    case "guard": {
      const g = d.trace?.guard ?? "";
      const cls = /^Rejected/.test(g) ? "bad" : /raised/.test(g) ? "warn" : "ok";
      const head = cls === "bad" ? "Answer rejected" : cls === "warn" ? "Severity corrected" : "Answer accepted";
      return `<p class="why">These checks are written in code, not in the prompt, so the model can't talk its way past them.</p>
        <dl class="kv"><dt>Lowest severity the evidence allows</dt><dd class="big">${esc(PRIORITY[d.floor])}</dd>
        <dt>Final severity</dt><dd class="big">${esc(PRIORITY[d.severity])} <span style="font-size:16px;font-weight:400;color:var(--muted)">· ${Math.round(d.confidence * 100)}% confident</span></dd></dl>
        <div class="verdict ${cls}">${head}<small>${esc(g)}</small></div>`;
    }
    case "plan": return `<p class="why">${d.text ? `<b>${esc(d.text)}.</b> ` : ""}${d.engine === "droid" ? "Factory Droid read the evidence and the machine layout and wrote these commands. It can only propose: it ran with every tool permission refused, and code raises its plan to a major change when the situation requires one." : "A scripted plan stands in for Factory Droid here."} Every plan, scripted or Droid, must pass the same test before it can touch the real machine.</p>
      ${d.rationale ? `<p class="note"><b>Droid's reasoning:</b> ${esc(d.rationale)}</p>` : ""}${d.note ? `<p class="note">${esc(d.note)}</p>` : ""}
      <pre class="code">${d.commands.map(esc).join("\n")}</pre>
      <p class="note">${d.drastic ? "<b>Major change</b>, so a person must approve it." : "<b>Minor change</b>: if it passes the test, Batman may apply it on its own."}</p>`;
    case "clone": return `<p class="why">Batman never tests on the real machine. It makes a separate copy with everything on it, so the test is realistic.</p>
      <dl class="kv"><dt>Copy id</dt><dd><code>${esc(d.id)}</code></dd></dl>`;
    case "checked": {
      const before = new Map((d.before ?? []).map((c) => [c.name, c.passed]));
      return `<p class="why">The fix runs on the copy, then the same checks run again. The copy is deleted afterwards.</p>
        <table class="checks2"><thead><tr><th>Check</th><th>Before fix</th><th>After fix</th></tr></thead><tbody>
        ${d.checks.map((c) => `<tr><td>${esc(c.name)}</td><td>${before.has(c.name) ? (before.get(c.name) ? '<span class="yes">✓</span>' : '<span class="no">✗</span>') : "—"}</td><td>${c.passed ? '<span class="yes">✓ pass</span>' : '<span class="no">✗ fail</span>'}</td></tr>`).join("")}
        </tbody></table>
        <div class="verdict ${d.passed ? "ok" : "bad"}">${d.passed ? `Passed all ${d.checks.length} checks on the copy` : "Failed on the copy"}${d.remaining?.length ? `<small>Still present: ${esc(d.remaining.join("; "))}</small>` : ""}</div>`;
    }
    case "decision": {
      const a = d.action;
      const on = (x) => (x ? "on" : "");
      return `<p class="why">A fixed rule in code, not the AI, makes this call.</p>
        <div class="flow">
          <span class="node q on">Passed on the copy?</span>
          <div class="branch">
            <div class="branch-row"><span class="arrow ${on(!d.passed)}">no →</span><span class="node end ${!d.passed ? "on stop" : ""}">Reject, don't touch the machine</span></div>
            <div class="branch-row"><span class="arrow ${on(d.passed)}">yes →</span><span class="node q ${on(d.passed)}">Major change?</span>
              <span class="arrow ${on(d.passed && d.drastic)}">yes →</span><span class="node end ${a === "await_approval" ? "on wait" : ""}">Ask an analyst</span>
              <span class="arrow ${on(d.passed && !d.drastic)}">no →</span><span class="node end ${a === "apply" ? "on good" : ""}">Apply automatically</span></div>
          </div>
        </div>
        <p class="note">${esc(d.reason)}</p>`;
    }
    case "approve": {
      const waiting = state.incident?.status === "awaiting_approval";
      return `<p class="why">The fix passed on the copy, but it's a major change, so Batman waits for a person. In production the analyst gets a text and replies APPROVE.</p>
        ${waiting ? `<div class="actions"><button class="yes-btn" id="approve" ${state.acting ? "disabled" : ""}>Approve fix</button><button class="no-btn" id="reject" ${state.acting ? "disabled" : ""}>Reject</button></div>` : `<p class="note">Working…</p>`}`;
    }
    case "human": return `<p class="why">${esc(d.by)} ${d.action === "approved" ? "approved the fix. Only now may it touch the real machine." : "rejected the fix. Nothing on the real machine changes."}</p>`;
    case "applied": return `<p class="why">The same commands that passed on the copy now run on the real machine.</p><pre class="code">${(d.commands ?? []).map(esc).join("\n")}</pre>`;
    case "verified": return `<p class="why">Batman runs every check again on the real machine.</p>
      <div class="verdict ${d.clean ? "ok" : "bad"}">${d.clean ? "Clean. The ticket is resolved." : "Problems remain."}</div>`;
    case "summary": return summary();
    case "failed": return `<div class="verdict bad">Stopped after the "${esc(d.after)}" step<small>${esc(d.message)}</small></div>
      <p class="note">Any machines this run created have been deleted. The terminal running <code>npm run dev</code> shows each step as it happens; check it, then pick an alert to try again.</p>`;
  }
}

const LABEL = { agent: "Queries and intel lookups", "machine.created": "Connect to machine", "threat.started": "Simulated threat", queries: "Read-only queries", investigation: "AI investigation + guardrails", plan: "Plan the fix", "clone.created": "Make a test copy", "clone.checked": "Test the fix on the copy", applied: "Apply to real machine", verified: "Re-check real machine" };
function summary() {
  const t = state.trace;
  // Agent queries and intel lookups are summed into one bar; everything else keeps its own.
  const steps = [];
  for (const s of t.steps) {
    if (s.ms == null) continue;
    if (s.kind === "agent") {
      const bar = steps.find((b) => b.kind === "agent");
      if (bar) bar.ms += s.ms; else steps.push({ kind: "agent", ms: s.ms });
    } else if (LABEL[s.kind]) steps.push({ kind: s.kind, ms: s.ms });
  }
  const human = t.steps.find((s) => s.kind === "human");
  // Wall-clock start to finish, minus any time spent waiting for the analyst.
  const last = t.steps.at(-1);
  const decision = t.steps.find((s) => s.kind === "decision");
  const waited = human && decision ? human.at - decision.at : 0;
  const machineTime = last.at - t.startedAt - waited;
  const max = Math.max(...steps.map((s) => s.ms), 1);
  return `<p class="why">Everything you just stepped through, start to finish at real speed${human ? ", not counting the time waiting for the analyst" : ""}:</p>
    <div class="total">${secs(machineTime)}</div>
    <div class="bars">${steps.map((s) => `<div class="bar"><span>${esc(LABEL[s.kind])}</span><span class="track"><span class="fill" style="width:${(100 * s.ms) / max}%"></span></span><span class="ms">${ms(s.ms)}</span></div>`).join("")}</div>
    <p class="note">Next: the same engine in the <a href="../">real-time demo</a>.</p>`;
}

/** The ticket's status at the point the presenter has reached, so the side panel never gets ahead of the story. */
function statusAsOf(visible) {
  let s = "detected";
  for (const sl of visible) {
    if (sl.key === "sent" || sl.key === "guard" || (sl.kind === "agent" && s === "detected")) s = "investigating";
    if (sl.key === "plan" || sl.key === "clone" || sl.key === "checked") s = "testing_fix";
    if (sl.key === "decision") s = sl.d.action === "await_approval" ? "awaiting_approval" : sl.d.action === "reject" ? "fix_rejected" : "testing_fix";
    if (sl.key === "human") s = sl.d.action === "approved" ? "testing_fix" : "fix_rejected";
    if (sl.key === "verified") s = sl.d.clean ? "resolved" : "fix_rejected";
  }
  return s;
}

/* ---------- side panel: ticket + machines, as of the revealed slide ---------- */

function side(visible) {
  const keys = new Set(visible.map((s) => s.key));
  const inc = state.incident;
  const machine = visible.find((s) => s.key === "machine");
  const clone = visible.find((s) => s.key === "clone");
  const checked = visible.find((s) => s.key === "checked");
  const verified = visible.find((s) => s.key === "verified");
  const isPc = machine?.d.role === "pc";
  const company = !machine ? ["off", "Not connected yet"]
    : verified ? (verified.d.clean ? ["clean", "Clean, verified"] : ["infected", "Problems remain"])
    : keys.has("threat") ? ["infected", isPc ? (state.tier === "low" ? "Malicious file in Business folder" : "Unknown sign-in, session live") : state.tier === "low" ? "Unapproved scheduled task" : "Threat running"] : ["clean", "Healthy"];
  const copy = !clone ? ["off", "Not created"] : checked ? ["gone", checked.d.passed ? "Fix passed · copy deleted" : "Fix failed · copy deleted"] : ["testing", "Testing the fix"];
  const ticketShown = keys.has("alert");
  const [label, cls] = STATUS[statusAsOf(visible)] ?? ["—", "s-progress"];
  const sevKnown = keys.has("guard") && inc;
  return `<div class="ex-side">
    <section class="card"><h2>The ticket</h2>${ticketShown && inc ? `
      <span class="pill ${cls}">${esc(label)}</span>
      <div class="mini-title">${esc(inc.title)}</div>
      <div class="mini-meta">Priority: ${sevKnown ? `<span class="p-${inc.severity}">${PRIORITY[inc.severity]}</span>` : `<span class="p-undeclared">Undeclared</span>`} · Assigned to Batman</div>` : `<p class="empty">No ticket yet.</p>`}
    </section>
    <section class="card"><h2>Machines</h2>
      <div class="machine ${company[0]}"><div class="m-head">${isPc ? "Robin's PC" : "Company machine"} <span class="m-id">${esc(machine?.d.id ?? "")}</span></div><div class="m-state">${esc(company[1])}</div></div>
      <div class="machine ${copy[0]}"><div class="m-head">Test copy <span class="m-id">${esc(clone?.d.id ?? "")}</span></div><div class="m-state">${esc(copy[1])}</div></div>
    </section></div>`;
}

/* ---------- render ---------- */

let lastShown = -1;
function whoOf(key) {
  if (key === "daytona" && state.info?.backend !== "daytona") return ["Sandbox", "w-daytona"];
  return WHO[key] ?? ["", ""];
}

function render() {
  const animate = state.shown !== lastShown;
  lastShown = state.shown;
  const all = slides();
  const visible = all.slice(0, state.shown);
  const more = all.length > state.shown;
  const running = state.id && !finished();
  bar.innerHTML = `
    <b>HOW IT WORKS</b>
    <button class="low" data-tier="low" ${running ? "disabled" : ""}>Low tier alert</button>
    <button class="high" data-tier="high" ${running ? "disabled" : ""}>High tier alert</button>
    <button class="agent" data-tier="agent" ${running ? "disabled" : ""}>AI agent alert</button>
    ${state.id ? `<button class="next" id="next" ${more ? "" : "disabled"}>${more ? "Next ▸" : running ? "Waiting for Batman…" : "Done"}</button>
      <span class="count">Step ${state.shown} of ${all.length}${running ? "+" : ""}</span>` : ""}
    <span class="chips">${state.info ? `<span class="chip">Machine: ${state.info.backend === "daytona" ? "Daytona" : "local sandbox"}</span><span class="chip">AI: ${state.info.investigator === "gemini" ? "Gemini" : "built-in rules"}</span>` : ""}
      <a class="switch" href="../">Real-time demo →</a></span>`;
  bar.querySelectorAll("[data-tier]").forEach((b) => (b.onclick = () => start(b.dataset.tier)));
  bar.querySelector("#next")?.addEventListener("click", next);

  if (!state.id) {
    app.innerHTML = `<section class="card start"><h1>How Batman handles an alert</h1>
      <p>Pick an alert. The real engine runs it at full speed in the background; you step through what it did, one step at a time.</p>
      ${state.error ? `<p style="color:var(--bad)">${esc(state.error)}</p>` : ""}
      <div class="actions"><button class="low-btn" data-tier="low">Low tier alert</button><button class="high-btn" data-tier="high">High tier alert</button><button class="agent-btn" data-tier="agent">AI agent alert</button></div></section>`;
    app.querySelectorAll("[data-tier]").forEach((b) => (b.onclick = () => start(b.dataset.tier)));
    return;
  }
  const current = visible.at(-1);
  const past = visible.slice(0, -1);
  app.innerHTML = `<div class="ex-grid">${side(visible)}<div class="steps">
    ${past.map((s) => { const [w, c] = whoOf(s.who); return `<div class="card past"><span class="t">${s.at != null ? secs(s.at) : ""}</span><span class="who ${c} who-lg">${esc(w)}</span><b>${esc(s.title)}</b><span class="ms">${ms(s.ms)}</span></div>`; }).join("")}
    ${current ? (() => { const [w, c] = whoOf(current.who); return `<section class="card step ${animate ? "fresh" : ""}" aria-live="polite">
      <div class="step-head"><span class="who-lg ${c}">${esc(w)}</span><h1>${esc(current.title)}</h1>
        <span class="timing">${current.at != null ? `at <b>${secs(current.at)}</b>` : ""}${current.ms != null ? `<br>took ${ms(current.ms)}` : ""}</span></div>
      ${body(current)}</section>`; })() : `<section class="card step"><div class="step-head"><h1>Alert sent to Batman</h1></div><p class="why">Press <b>Next</b> (or →, Space) to walk through what it does.</p></section>`}
    ${state.error ? `<p style="color:var(--bad)">${esc(state.error)}</p>` : ""}
  </div></div>`;
  app.querySelector("#approve")?.addEventListener("click", () => decide("approve"));
  app.querySelector("#reject")?.addEventListener("click", () => decide("reject"));
}

/* ---------- actions ---------- */

function next() {
  const all = slides();
  if (state.shown < all.length) { state.shown++; render(); window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" }); }
}

async function start(tier) {
  clearInterval(state.poll);
  Object.assign(state, { tier, id: null, trace: null, incident: null, shown: 0, error: "" });
  try {
    const r = await fetch(`/defense/scenario/${tier}/start`, { method: "POST" });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || r.statusText);
    state.id = body.incidentId;
    state.poll = setInterval(refresh, 400);
  } catch (e) { state.error = String(e.message || e); }
  render();
}

let lastSig = "";
async function refresh() {
  if (!state.id) return;
  try {
    const t = await fetch(`/defense/trace/${state.id}`);
    if (t.ok) { const j = await t.json(); if (j) state.trace = j; }
    if (state.trace?.steps.some((s) => s.kind === "alert")) {
      const i = await fetch(`/api/incidents/${state.id}`);
      if (i.ok) state.incident = await i.json();
    }
  } catch { /* keep last state */ }
  const sig = JSON.stringify([state.trace?.steps.length, state.incident?.status, state.incident?.severity]);
  if (sig === lastSig) return;
  lastSig = sig;
  if (finished() && state.incident && ["resolved", "fix_rejected"].includes(state.incident.status)) clearInterval(state.poll);
  render();
}

async function decide(action) {
  state.acting = true;
  render();
  try {
    const r = await fetch(`/defense/demo-${action}/${state.id}`, { method: "POST" });
    if (!r.ok) throw new Error((await r.json()).error);
    clearInterval(state.poll);
    state.poll = setInterval(refresh, 400);
  } catch (e) { state.error = String(e.message || e); }
  state.acting = false;
  render();
}

// Presentation clickers send PageDown / ArrowRight.
document.addEventListener("keydown", (e) => {
  if (["ArrowRight", "PageDown", " "].includes(e.key) && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); next(); }
});

fetch("/defense/info").then((r) => r.json()).then((i) => { state.info = i; render(); }).catch(() => {});
render();
