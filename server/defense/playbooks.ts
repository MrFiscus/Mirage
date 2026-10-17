// Demo playbooks on "Robin's PC" (Person 2): a malicious download (low tier) and a sign-in from a new location (high tier).
// Every step runs a real read-only command on the sandbox, or a lookup against the local intel list that stands in
// for VirusTotal / ipinfo / AbuseIPDB, and records a plain sentence plus the exact query for the demo pages.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { applyFix, analystPhone } from "./apply.js";
import type { FixPlan, Incident } from "./contracts.js";
import { sendSms } from "./core.js";
import { decide } from "./decision.js";
import { GeminiInvestigator, type CaseInput } from "./gemini.js";
import { clean, type Investigation } from "./investigator.js";
import { createInvestigator } from "./investigators.js";
import { audit, runs, timed, traceStep, update } from "./run.js";
import type { Sandbox } from "./sandbox/index.js";
import { createCompanyMachine } from "./sandbox/index.js";
import { collectHealth } from "./telemetry.js";

export const PC_SCRIPT = fileURLToPath(new URL("../../sim/pc.cjs", import.meta.url));
const intel = JSON.parse(readFileSync(fileURLToPath(new URL("../../sim/intel.json", import.meta.url)), "utf8")) as {
  files: Record<string, { verdict: string; detections: string; label: string; firstSeen: string }>;
  domains: Record<string, { age: string; category: string }>;
  ips: Record<string, { city: string; lat: number; lon: number; asn: string; abuseScore: number; reports: number; vpnOrTor: boolean }>;
};

export const USER = "robin.business@harvard.edu";
export const PLAYBOOK_TITLES = {
  low: `Malicious file download attempt on PC: ${USER}`,
  high: `Login from unknown location for ${USER}`,
} as const;
export type Tier = keyof typeof PLAYBOOK_TITLES;
export const isPlaybook = (s: string): s is Tier => s === "low" || s === "high";

type Who = "batman" | "edr" | "idp" | "virustotal" | "ipinfo" | "abuseipdb" | "photon";
type Check = { name: string; passed: boolean; detail?: string };

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
async function look(sb: Sandbox, cmd: string): Promise<string[]> { return lines((await sb.exec(cmd)).stdout); }

/** One step of the agent: what it did in plain words, the exact query, and what came back. */
async function agent<T>(id: string, who: Who, query: string, work: () => Promise<T>, say: (r: T) => { text: string; result?: string[] }): Promise<T> {
  const t = Date.now();
  const r = await work();
  const { text, result } = say(r);
  traceStep(id, "agent", { who, text, query, result: (result ?? []).map(clean) }, Date.now() - t);
  audit("agent.step", text);
  return r;
}

async function pcChecks(sb: Sandbox, args: string): Promise<Check[]> {
  const out = await sb.runScript(PC_SCRIPT, args);
  let pc: Check[] = [];
  try { pc = JSON.parse(out.stdout).checks; } catch { pc = [{ name: "PC check script", passed: false, detail: out.stdout.slice(0, 120) }]; }
  const health = (await collectHealth(sb)).map((c) => ({ ...c, name: `Machine health: ${c.name}` }));
  return [...pc, ...health];
}

function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lon - a.lon) / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
}
const field = (line: string, k: string) => new RegExp(`(?:^|\\s)${k}=(\\S+)`).exec(line)?.[1] ?? "";

/** Gemini (with guardrails) when configured, otherwise the deterministic answer. */
async function investigate(input: CaseInput): Promise<Investigation> {
  const inv = createInvestigator();
  return inv instanceof GeminiInvestigator ? inv.judge(input) : input.fallback();
}

// A claim counts only when asserted: "the file was opened" is a claim, "it was never opened" / "not a VPN" is not.
const NEGATION = /\b(not|never|no|without|neither|nor|none|n't|cannot|wasn't|isn't|hasn't|didn't|unconfirmed|no evidence)\b/i;
export const claimChecker = (claims: { pattern: RegExp; present: boolean; what: string }[]) => (text: string) => {
  const found = new Set<string>();
  for (const clause of text.replace(/\([^)]*\)/g, "").split(/[.;,:]\s+|\s+(?:but|and|while|although)\s+/i)) {
    for (const c of claims) {
      if (c.present) continue;
      const m = c.pattern.exec(clause);
      if (m && !NEGATION.test(clause.slice(0, m.index + m[0].length))) found.add(c.what);
    }
  }
  return [...found];
};

/* ------------------------------------------------------------------ */

export async function runPlaybook(tier: Tier, id: string, machines: Sandbox[]): Promise<Incident> {
  const company = await timed(id, "machine.created", () => createCompanyMachine(), (m) => ({ id: m.id, backend: process.env.SANDBOX_BACKEND === "daytona" ? "daytona" : "local", role: "pc" }));
  machines.push(company);
  audit("scenario.start", `${tier} tier; Robin's PC ${company.id} created`);
  return tier === "low" ? fileDownload(id, company) : unknownLogin(id, company);
}

function openIncident(id: string, title: string): Incident {
  const incident: Incident = {
    id, title, status: "detected", severity: "low", confidence: 0, evidence: [],
    technicalSummary: "Alert received; investigation pending.",
    businessSummary: "An alert was raised for a company user. Investigation is starting.",
    createdAt: Date.now(),
  } as Incident;
  update(incident, {});
  traceStep(id, "alert", { title });
  update(incident, { status: "investigating" });
  return incident;
}

/** Shared tail: plan → test on a copy → decision → apply or wait for the analyst. */
async function testAndDecide(id: string, incident: Incident, company: Sandbox, plan: FixPlan, checkArgs: string, planText: string): Promise<Incident> {
  traceStep(id, "plan", { planner: "scripted (Droid placeholder)", commands: plan.commands, drastic: plan.drastic, text: planText });
  audit("fix.planned", `scripted (Droid placeholder): ${plan.commands.length} steps, ${plan.drastic ? "major change" : "minor change"}`);
  update(incident, { status: "testing_fix", proposedFix: plan });

  const copy = await timed(id, "clone.created", () => company.clone(), (c) => ({ id: c.id }));
  runs.get(id)!.clone = copy;
  audit("clone.created", `test copy ${copy.id} created`);
  const t = Date.now();
  const before = await pcChecks(copy, checkArgs);
  const commandFailures: string[] = [];
  for (const cmd of plan.commands) {
    const r = await copy.exec(cmd);
    if (r.code !== 0) { commandFailures.push(`${cmd} (exit ${r.code})`); break; }
  }
  const after = await pcChecks(copy, checkArgs);
  const checks = [...after.map(({ name, passed }) => ({ name, passed })), { name: "Fix commands succeeded", passed: commandFailures.length === 0 }];
  const passed = checks.every((c) => c.passed);
  traceStep(id, "clone.checked", { before, checks, passed, remaining: after.filter((c) => !c.passed).map((c) => c.name), commandFailures }, Date.now() - t);
  audit("clone.checked", `after fix passed=${passed}`);
  const checked = { ...plan, cloneCheck: { passed, checks } };
  update(incident, { proposedFix: checked });
  await copy.destroy();
  traceStep(id, "clone.destroyed", { id: copy.id });

  const decision = decide(checked);
  audit("decision", `${decision.action}: ${decision.reason}`);
  traceStep(id, "decision", { action: decision.action, reason: decision.reason, passed, drastic: plan.drastic });
  if (decision.action === "reject") {
    update(incident, { status: "fix_rejected", technicalSummary: incident.technicalSummary + ` Proposed fix rejected: ${decision.reason}.` });
  } else if (decision.action === "await_approval") {
    update(incident, { status: "awaiting_approval" });
    const body = `Batman: ${incident.title}. Priority ${incident.severity}. Proposed: ${planText.toLowerCase()} (passed ${checks.length}/${checks.length} checks on a test copy). Reply APPROVE ${incident.id} to apply.`;
    await agent(id, "photon", `POST Photon message to on-call analyst ${analystPhone()}   (demo mode: logged, not sent)`, async () => sendSms(analystPhone(), body),
      () => ({ text: `Alerted the on-call analyst for next steps: proposed to ${planText.charAt(0).toLowerCase()}${planText.slice(1)}`, result: [body] }));
  } else {
    await applyFix(id);
  }
  return incident;
}

/* ------------------------------ low tier ------------------------------ */

async function fileDownload(id: string, pc: Sandbox): Promise<Incident> {
  const setup = await timed(id, "threat.started", () => pc.runScript(PC_SCRIPT, "file"), () => ({ tier: "low", text: "Simulated: Robin's browser downloads Invoice_Q3.exe from invoice-portal.example (a harmless test file)" }));
  const { rel, win } = JSON.parse(setup.stdout) as { rel: string; win: string };
  runs.set(id, { company: pc, verify: (sb) => pcChecks(sb, `check-file '${rel}'`) });

  const edr = await agent(id, "edr", `grep -h 'event=file_created' pc/logs/edr.log | grep 'type=executable' | tail -1`,
    () => look(pc, `grep -h 'event=file_created' pc/logs/edr.log | grep 'type=executable' | tail -1`),
    (r) => ({ text: `Endpoint alert: an unsigned program was just saved to Robin's PC by the browser`, result: r }));
  if (!edr.length) throw new Error("no endpoint alert found");
  const incident = openIncident(id, PLAYBOOK_TITLES.low);

  const found = await agent(id, "batman", `find pc/C/Business -type f -iname '*.exe'`, () => look(pc, `find pc/C/Business -type f -iname '*.exe'`),
    (r) => ({ text: `Found the file at ${r.map((p) => p.replace(/^pc\/C\//, "C:/")).join(", ") || "(not found)"}`, result: r }));
  const path = found[0] ?? rel;

  const source = await agent(id, "batman", `grep -h 'ObviousVirus.exe' pc/logs/downloads.log`, () => look(pc, `grep -h 'ObviousVirus.exe' pc/logs/downloads.log`),
    (r) => ({ text: `Traced where it came from: Edge downloaded it from ${new URL(field(r[0] ?? "", "url") || "http://unknown").hostname}`, result: r }));
  const domain = new URL(field(source[0] ?? "", "url") || "http://unknown").hostname;

  const hashLine = await agent(id, "batman", `sha256sum '${path}'`, () => look(pc, `sha256sum '${path}'`),
    (r) => ({ text: `Calculated the file's SHA-256 fingerprint`, result: r }));
  const hash = (hashLine[0] ?? "").split(/\s+/)[0];

  const hit = intel.files[hash];
  await agent(id, "virustotal", `GET https://www.virustotal.com/api/v3/files/${hash}   (placeholder: sim/intel.json)`, async () => hit,
    (h) => ({ text: h ? `Checked the fingerprint against threat intelligence: ${h.detections} engines flag it as malicious, ${h.label}` : "Checked the fingerprint against threat intelligence: no match", result: [h ? `verdict=${h.verdict} detections=${h.detections} label="${h.label}" first_seen=${h.firstSeen}` : "no record"] }));
  const dom = intel.domains[domain];
  await agent(id, "virustotal", `GET https://www.virustotal.com/api/v3/domains/${domain}   (placeholder: sim/intel.json)`, async () => dom,
    (d) => ({ text: d ? `Checked the download site ${domain}: ${d.age}, ${d.category}` : `Checked the download site ${domain}: no record`, result: [d ? `domain=${domain} age="${d.age}" category="${d.category}"` : "no record"] }));

  const ran = await agent(id, "edr", `grep -h 'ObviousVirus' pc/logs/process.log || true`, () => look(pc, `grep -h 'ObviousVirus' pc/logs/process.log || true`),
    (r) => ({ text: r.length ? "Checked whether it ran: it was started" : "Checked whether it ran: it never started, so the download was caught in time", result: r.length ? r : ["no process started from this file"] }));

  const malicious = hit?.verdict === "malicious";
  const executed = ran.length > 0;
  const evidence = [
    `edr: ${edr[0]}`, `download: ${source[0] ?? ""}`, `sha256: ${hash}`,
    `intel: ${hit ? `verdict=${hit.verdict} detections=${hit.detections} label=${hit.label}` : "no record"}`,
    `domain: ${domain} ${dom ? `${dom.age}, ${dom.category}` : "no record"}`,
    `process: ${executed ? ran[0] : "no process started from this file"}`,
  ].map(clean);
  const floor = malicious && executed ? "high" : malicious ? "low" : "low";
  const result = await investigate({
    context: "endpoint and threat-intelligence evidence about one downloaded file on a user's PC",
    policy: "LOW when a file confirmed malicious by threat intelligence was downloaded but never ran and can be quarantined. HIGH when a malicious file ran. MEDIUM when the file is suspicious but not confirmed malicious.",
    evidence, floor,
    unsupported: claimChecker([
      { pattern: /\b(ran|executed|launched|opened|was run|infected)\b/i, present: executed, what: "the file running" },
      { pattern: /\b(spread|other (machines|computers|devices)|lateral)\b/i, present: false, what: "spread to other machines" },
    ]),
    fallback: async () => ({
      engine: "rules", severity: floor, confidence: malicious ? 0.9 : 0.5, evidence,
      technicalSummary: `Unsigned executable written by msedge.exe to ${win}; SHA-256 ${hash} matches threat intelligence (${hit?.detections ?? "n/a"}, ${hit?.label ?? "n/a"}); source ${domain} (${dom?.age ?? "unknown age"}). No process started from the file.`,
      businessSummary: `A known-malicious file was downloaded to a staff member's computer but never opened. Batman is removing it and blocking the site it came from; no data loss is confirmed.`,
      trace: { sent: evidence, guard: "Built-in rules: severity from the observed evidence (no AI model configured)." },
    }),
  });
  const { engine, trace, ...inv } = result;
  update(incident, inv);
  audit("investigation.done", `${engine ?? "investigator"}: severity ${inv.severity}, confidence ${inv.confidence}, ${inv.evidence.length} evidence items`);
  traceStep(id, "investigation", { engine, trace, severity: inv.severity, confidence: inv.confidence, evidence: inv.evidence, floor }, trace?.ms);

  const plan: FixPlan = {
    drastic: false,
    commands: [
      "mkdir -p pc/quarantine",
      `mv '${path}' pc/quarantine/ObviousVirus.exe.quarantined`,
      "chmod 000 pc/quarantine/ObviousVirus.exe.quarantined",
      `echo '${domain}' >> pc/policy/blocked-domains.txt`,
    ],
  };
  return testAndDecide(id, incident, pc, plan, `check-file '${rel}'`, "Quarantine the file and block the download site");
}

/* ------------------------------ high tier ------------------------------ */

async function unknownLogin(id: string, pc: Sandbox): Promise<Incident> {
  await timed(id, "threat.started", () => pc.runScript(PC_SCRIPT, "login"), () => ({ tier: "high", text: "Simulated: a successful sign-in to Robin's account from an address Robin has never used" }));
  runs.set(id, { company: pc, verify: (sb) => pcChecks(sb, "check-login") });

  const alert = await agent(id, "idp", `grep -h 'idp_risk' pc/logs/idp-alerts.log | tail -1`, () => look(pc, `grep -h 'idp_risk' pc/logs/idp-alerts.log | tail -1`),
    (r) => ({ text: "Identity provider alert: unfamiliar sign-in to Robin's account", result: r }));
  if (!alert.length) throw new Error("no identity alert found");
  const incident = openIncident(id, PLAYBOOK_TITLES.high);
  const ip = field(alert[0], "ip");

  const recent = await agent(id, "batman", `grep -h 'user=${USER}' pc/logs/signin.log | tail -3`, () => look(pc, `grep -h 'user=${USER}' pc/logs/signin.log | tail -3`),
    (r) => ({ text: `Pulled Robin's latest sign-ins: the newest is from ${ip}, ${field(r.at(-1) ?? "", "result")} with MFA ${field(r.at(-1) ?? "", "mfa").replace("_", " ")}`, result: r }));
  const latest = recent.at(-1) ?? "";
  const previous = recent.at(-2) ?? "";

  const geo = intel.ips[ip];
  await agent(id, "ipinfo", `GET https://ipinfo.io/${ip}/json   (placeholder: sim/intel.json)`, async () => geo,
    (g) => ({ text: g ? `Checked the IP: ${ip} is in ${g.city} (${g.asn})` : `Checked the IP: ${ip} has no location record`, result: [g ? `ip=${ip} city="${g.city}" asn="${g.asn}"` : "no record"] }));

  const history = await agent(id, "batman", `grep -h 'user=${USER}' pc/logs/signin.log | grep -o 'loc=[^ ]*' | sort | uniq -c`,
    () => look(pc, `grep -h 'user=${USER}' pc/logs/signin.log | grep -o 'loc=[^ ]*' | sort | uniq -c`),
    (r) => {
      const loc = field(latest, "loc");
      const parse = (l: string) => { const [n, rest] = l.trim().split(/\s+/); return { n: Number(n), loc: rest.replace(/^loc=/, "").replace(/,/g, ", ") }; };
      const usual = r.filter((l) => !l.includes(loc)).map(parse);
      const seen = r.filter((l) => l.includes(loc)).map(parse)[0]?.n ?? 0;
      return { text: `Verified the location is new: in the last 30 days Robin signed in only from ${usual.map((u) => `${u.loc} (${u.n} sign-ins)`).join(", ")}; ${loc.replace(/,/g, ", ")} appears ${seen === 1 ? "once, today" : `${seen} times`}`, result: r };
    });
  const newLocation = history.find((l) => l.includes(field(latest, "loc")))?.trim().startsWith("1 ") ?? false;

  const prevGeo = intel.ips[field(previous, "ip")];
  const minutes = Math.max(1, Math.round((Date.parse(latest.split(" ")[0]) - Date.parse(previous.split(" ")[0])) / 60000));
  const distance = prevGeo && geo ? km(prevGeo, geo) : 0;
  const speed = Math.round(distance / (minutes / 60));
  const impossible = speed > 900;
  await agent(id, "batman", `distance(${field(previous, "loc")} → ${field(latest, "loc")}) / time between sign-ins`, async () => impossible,
    () => ({ text: impossible ? `Impossible travel: ${prevGeo?.city ?? "?"} to ${geo?.city ?? "?"} is ${distance.toLocaleString()} km in ${minutes} minutes (${speed.toLocaleString()} km/h)` : `Travel check: ${distance} km in ${minutes} minutes is possible`, result: [`previous: ${previous}`, `latest: ${latest}`, `distance_km=${distance} minutes=${minutes} speed_kmh=${speed}`] }));

  await agent(id, "abuseipdb", `GET https://api.abuseipdb.com/api/v2/check?ipAddress=${ip}   (placeholder: sim/intel.json)`, async () => geo,
    (g) => ({ text: g && g.abuseScore === 0 && !g.vpnOrTor ? `Checked the IP's reputation: clean (abuse score ${g.abuseScore}/100, ${g.reports} reports, not a VPN or Tor exit)` : `Checked the IP's reputation: abuse score ${g?.abuseScore ?? "?"}/100`, result: [g ? `abuseConfidenceScore=${g.abuseScore} totalReports=${g.reports} isTorOrVpn=${g.vpnOrTor}` : "no record"] }));
  const repBad = Boolean(geo && (geo.abuseScore > 25 || geo.vpnOrTor));

  const sessions = await agent(id, "idp", `grep -h 'ip=${ip}' pc/state/sessions.txt`, () => look(pc, `grep -h 'ip=${ip}' pc/state/sessions.txt`),
    (r) => ({ text: r.length ? `Found a live session from that address in ${field(r[0], "app")} right now` : "No live session from that address", result: r }));

  const evidence = [
    `idp: ${alert[0]}`, `signin: ${latest}`, `previous: ${previous}`,
    `geo: ${ip} ${geo?.city ?? "unknown"} ${geo?.asn ?? ""}`,
    `history: ${history.join("; ")}`,
    `travel: ${distance} km in ${minutes} min (${speed} km/h)`,
    `reputation: abuseScore=${geo?.abuseScore ?? "?"} reports=${geo?.reports ?? "?"} vpnOrTor=${geo?.vpnOrTor ?? "?"}`,
    `session: ${sessions[0] ?? "none"}`,
  ].map(clean);
  const floor = newLocation && impossible && sessions.length ? "high" : newLocation ? "medium" : "low";
  const result = await investigate({
    context: "identity-provider sign-in evidence for one user account",
    policy: "HIGH when a successful sign-in comes from a never-before-seen location with impossible travel and a live session. MEDIUM when the location is new but travel is possible. LOW when the location is familiar. A clean IP reputation does not lower the severity on its own.",
    evidence, floor,
    unsupported: claimChecker([
      { pattern: /\b(malicious|known[- ]bad|blacklist\w*|botnet|tor exit|abusive)\b.*\b(ip|address)\b|\b(ip|address)\b.*\b(malicious|known[- ]bad|blacklist\w*|botnet|abusive)\b/i, present: repBad, what: "a bad IP reputation" },
      { pattern: /\b(password (was )?(stolen|leaked|phished)|credentials? (were |was )?(stolen|leaked|phished))\b/i, present: false, what: "stolen credentials" },
      { pattern: /\b(vpn|tor)\b/i, present: Boolean(geo?.vpnOrTor), what: "a VPN or Tor exit" },
    ]),
    fallback: async () => ({
      engine: "rules", severity: floor, confidence: impossible ? 0.85 : 0.6, evidence,
      technicalSummary: `Successful ${field(latest, "app")} sign-in for ${USER} from ${ip} (${geo?.city ?? "unknown"}, ${geo?.asn ?? ""}) with MFA ${field(latest, "mfa")}. Location never seen in 30 days; ${distance} km from the previous sign-in ${minutes} min earlier (${speed} km/h, impossible travel). IP reputation clean. Live session ${field(sessions[0] ?? "", "session") || "none"}.`,
      businessSummary: `Someone signed in to a staff member's account from a new country minutes after they signed in from Cambridge, which isn't physically possible. Batman recommends locking the account and signing out all sessions; no data loss is confirmed.`,
      trace: { sent: evidence, guard: "Built-in rules: severity from the observed evidence (no AI model configured)." },
    }),
  });
  const { engine, trace, ...inv } = result;
  update(incident, inv);
  audit("investigation.done", `${engine ?? "investigator"}: severity ${inv.severity}, confidence ${inv.confidence}, ${inv.evidence.length} evidence items`);
  traceStep(id, "investigation", { engine, trace, severity: inv.severity, confidence: inv.confidence, evidence: inv.evidence, floor }, trace?.ms);

  const plan: FixPlan = {
    drastic: true,
    commands: [
      `echo '${USER}' >> pc/policy/disabled-accounts.txt`,
      `{ grep -v 'user=${USER}' pc/state/sessions.txt || true; } > pc/state/sessions.tmp && mv pc/state/sessions.tmp pc/state/sessions.txt`,
      `echo '${USER}' >> pc/policy/password-reset-required.txt`,
    ],
  };
  return testAndDecide(id, incident, pc, plan, "check-login", "Lock Robin's account, sign out every session, require a password reset");
}
