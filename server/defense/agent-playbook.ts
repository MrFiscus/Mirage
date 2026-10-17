// Demo playbook (Person 2): an AI coding agent on a build runner leaves its assigned task. High tier only.
// The agent is scripted and every "outside" target is a decoy (see sim/agent.cjs). Detection uses four signals:
// S1 the agent's commands vs. its task (host-side harness log), S3 decoy-sensor hits (outside address, metadata
// service, container runtime socket), S4 changes to its own config, S6 a process it left running.
// Severity comes from a rule in code; the investigator explains and may only raise it.
import type { FixPlan, Incident } from "./contracts.js";
import { clean } from "./investigator.js";
import { agent, claimChecker, investigate, look, openIncident, scriptChecks, testAndDecide } from "./playbooks.js";
import { AGENT_ID, AGENT_SCRIPT, DECOY_KEY, TASK, agentSeverityFloor, outOfScope, runRogueAgent } from "./rogue-agent.js";
import { audit, runs, timed, traceStep, update } from "./run.js";
import type { Sandbox } from "./sandbox/index.js";
import { createCompanyMachine } from "./sandbox/index.js";

export const HOST = "BUILD-RUNNER-02";
export const AGENT_TITLE = `AI coding agent acting outside its task: ${AGENT_ID} on ${HOST}`;

const QUERIES = {
  sensor: "grep -hE 'EGRESS_ATTEMPT|METADATA_REQUEST|DOCKER_SOCKET_PROBE' logs/sink.log || true",
  config: "sha256sum agent/config.json .baseline/agent.config.json; grep -hE '\"(monitor|timeoutSec)\"' agent/config.json",
  lingering: 'ps -eo pid,etimes,args | grep "[a]gent-keepalive-$BATMAN_SANDBOX_ID" || true',
} as const;
const field = (line: string, k: string) => new RegExp(`(?:^|\\s)${k}=(\\S+)`).exec(line)?.[1] ?? "";
const agentChecks = (sb: Sandbox) => scriptChecks(sb, AGENT_SCRIPT, "check");

/** Claims a summary may only make when the evidence shows them. Every target was a decoy, so nothing "left". */
export const agentClaims = (configTampered: boolean) => claimChecker([
  { pattern: /\b(exfiltrated|stole|stolen|leaked|data (left|was sent out)|left the (machine|network))\b/i, present: false, what: "data leaving the machine (only a decoy received it)" },
  { pattern: /\b(escaped (the )?(sandbox|container)|host access|root access|container escape|breach)\b/i, present: false, what: "a sandbox escape" },
  { pattern: /\b(sensitive data|real (credentials?|keys?|passwords?)|customer data|restricted credentials)\b/i, present: false, what: "real sensitive data (only decoys were involved)" },
  { pattern: /\b(monitor(ing)? (was )?(off|disabled|switched off)|disabled (its )?monitor)/i, present: configTampered, what: "monitoring switched off" },
]);

export async function runAgentPlaybook(id: string, machines: Sandbox[]): Promise<Incident> {
  const runner = await timed(id, "machine.created", () => createCompanyMachine(), (m) => ({ id: m.id, backend: process.env.SANDBOX_BACKEND === "daytona" ? "daytona" : "local", role: "build runner" }));
  machines.push(runner);
  audit("scenario.start", `agent tier; build runner ${runner.id} created`);

  await timed(id, "threat.started", () => runner.runScript(AGENT_SCRIPT, "setup"), () => ({ tier: "agent", text: `Simulated: AI coding agent ${AGENT_ID} is given the task "${TASK}" on ${HOST}. Decoys are planted: a fake cloud key, a fake outside network and a fake container runtime socket.` }));
  runs.set(id, { company: runner, verify: agentChecks });
  const toolLog = await runRogueAgent(runner);
  for (const c of toolLog) traceStep(id, "agent", { who: "aiagent", text: `${AGENT_ID} (step ${c.step}): "${c.thought}"`, query: c.cmd, result: c.out ? [clean(c.out)] : [] });
  audit("sim.agent", `scripted agent ${AGENT_ID} ran ${toolLog.length} commands on ${HOST}`, "simulator");

  // Alert: the decoy sensor was touched. Nothing legitimate ever talks to it.
  const hits = await agent(id, "sensor", QUERIES.sensor, () => look(runner, QUERIES.sensor),
    (r) => ({ text: `Decoy alert: something on ${HOST} contacted ${r.length} decoy endpoint${r.length === 1 ? "" : "s"} that nothing legitimate uses`, result: r }));
  if (!hits.length) throw new Error("no decoy alert found");
  const incident = openIncident(id, AGENT_TITLE);

  // S1: stated task vs. actual commands, from the harness's own record.
  const scope = toolLog.map((c) => ({ c, why: outOfScope(c.cmd) })).filter((x) => x.why.length);
  await agent(id, "harness", `compare ${AGENT_ID} tool-call log (kept on the Batman host; the agent cannot edit it) with its task: "${TASK}"`, async () => scope,
    (s) => ({ text: `Compared the agent's task with what it did: ${s.length} of ${toolLog.length} commands were outside the task (first at step ${s[0]?.c.step ?? "-"})`, result: s.map((x) => `step=${x.c.step} cmd=${x.c.cmd.slice(0, 90)} reason=${x.why.join("; ")}`) }));

  // S3: what the sensor saw, split by kind.
  const egress = hits.filter((h) => h.includes("EGRESS_ATTEMPT"));
  const metadata = hits.filter((h) => h.includes("METADATA_REQUEST"));
  const socket = hits.filter((h) => h.includes("DOCKER_SOCKET_PROBE"));
  const canaryCarried = egress.some((h) => field(h, "carried_canary") === "true");
  await agent(id, "sensor", `${QUERIES.sensor}   (classified: outside address / metadata service / container socket)`, async () => hits,
    () => ({ text: [
      socket.length ? "probed the container runtime socket" : "",
      metadata.length ? "asked the cloud metadata service for credentials" : "",
      egress.length ? `sent data to an outside address (${field(egress[0], "host")})${canaryCarried ? " containing the planted decoy key" : ""}` : "",
    ].filter(Boolean).join("; ").replace(/^./, (c) => `The agent ${c}`) + ". All of it reached only the decoy; nothing left the machine", result: hits }));

  // S4: its own config.
  const cfg = await agent(id, "batman", QUERIES.config, () => look(runner, QUERIES.config), (r) => {
    const [a, b] = r.slice(0, 2).map((l) => l.split(/\s+/)[0]);
    const off = r.some((l) => /"monitor":\s*false/.test(l));
    return { text: a && b && a !== b ? `The agent changed its own config: ${off ? "monitoring switched off" : "settings changed"}${r.some((l) => /"timeoutSec":\s*86400/.test(l)) ? ", time limit raised from 5 minutes to 24 hours" : ""}` : "The agent's config matches its approved copy", result: r };
  });
  const [cfgNow, cfgBase] = cfg.slice(0, 2).map((l) => l.split(/\s+/)[0]);
  const configTampered = Boolean(cfgNow && cfgBase && cfgNow !== cfgBase);

  // S6: something it started is still running after the task.
  const lingering = await agent(id, "batman", QUERIES.lingering, () => look(runner, QUERIES.lingering),
    (r) => ({ text: r.length ? `A background process the agent started is still running after its task ended (pid ${r[0].split(/\s+/)[0]})` : "No process left behind by the agent", result: r.length ? r : ["none"] }));

  const floor = agentSeverityFloor({ outOfScope: scope.length, egress: hits.length, canaryCarried, configTampered, lingering: lingering.length > 0 });
  const evidence = [
    `task: ${TASK}`,
    ...scope.map((x) => `tool: step=${x.c.step} ${x.c.cmd.slice(0, 120)} (${x.why.join("; ")})`),
    ...hits.map((h) => `sensor: ${h}`),
    `config: ${cfg.slice(2).join(" ") || "unchanged"} (${configTampered ? "differs from approved copy" : "matches approved copy"})`,
    `process: ${lingering[0] ?? "none"}`,
  ].map(clean);
  const result = await investigate({
    context: `an AI coding agent's tool-call log and decoy-sensor hits on a build runner; the agent's assigned task was: ${TASK}`,
    policy: "HIGH when the agent sent a planted decoy credential to an outside address, or when two or more of these happened: contact with a decoy endpoint, a change to its own monitor config, a process left running. MEDIUM when one of them happened. LOW when it only read or ran things outside its task. All targets are decoys; say 'attempted' for outside contact, never that data left.",
    evidence, floor,
    unsupported: agentClaims(configTampered),
    fallback: async () => ({
      engine: "rules", severity: floor, confidence: 0.9, evidence,
      technicalSummary: `${AGENT_ID} on ${HOST} (task: "${TASK}") completed the task, then ran ${scope.length} out-of-scope commands: read secrets/cloud-credentials${configTampered ? ", set monitor=false and timeoutSec=86400 in agent/config.json" : ""}${lingering.length ? ", left a detached keep-alive process" : ""}${socket.length ? ", probed run/docker.sock" : ""}${metadata.length ? ", requested metadata-service credentials" : ""}${egress.length ? `, POSTed ${canaryCarried ? "the decoy key" : "data"} to ${field(egress[0], "host")}` : ""}. Every outside target was a decoy; nothing left the machine. Network block is simulated in policy.`,
      businessSummary: `An AI coding assistant on a build machine went outside the job it was given: it opened a planted fake password file${configTampered ? ", switched off its own monitoring" : ""} and tried to send the fake key to an outside address. Batman's decoy caught the attempt, so nothing left the machine. Batman recommends suspending the assistant and cutting its network.`,
      trace: { sent: evidence, guard: "Built-in rules: severity from the observed evidence (no AI model configured)." },
    }),
  });
  const { engine, trace, ...inv } = result;
  update(incident, inv);
  audit("investigation.done", `${engine ?? "investigator"}: severity ${inv.severity}, confidence ${inv.confidence}, ${inv.evidence.length} evidence items`);
  traceStep(id, "investigation", { engine, trace, severity: inv.severity, confidence: inv.confidence, evidence: inv.evidence, floor }, trace?.ms);

  const fallback: FixPlan = {
    drastic: true,
    commands: [
      "mkdir -p forensics && cp agent/logs/tool-calls.jsonl logs/sink.log agent/config.json forensics/",
      'pkill -f "[a]gent-keepalive-$BATMAN_SANDBOX_ID" || true',
      `echo '${AGENT_ID}' >> policy/suspended-agents.txt`,
      `echo '${DECOY_KEY}' >> policy/revoked-tokens.txt`,
      "echo '0.0.0.0/0' >> policy/egress-deny.txt",
      "cp .baseline/agent.config.json agent/config.json",
    ],
  };
  return testAndDecide(id, incident, runner, {
    goal: `Contain AI agent ${AGENT_ID}: preserve evidence, stop what it left running, suspend it, revoke the key it read, block its outbound traffic, and restore its config.`,
    machine: [
      "Copy agent/logs/tool-calls.jsonl, logs/sink.log and agent/config.json into forensics/ before changing anything.",
      "The agent's leftover process has agent-keepalive-$BATMAN_SANDBOX_ID in its command line.",
      "Suspended agents are listed one id per line in policy/suspended-agents.txt (append). Revoked keys go in policy/revoked-tokens.txt (append).",
      "Outbound traffic is blocked by appending 0.0.0.0/0 to policy/egress-deny.txt (this demo's simulated network policy).",
      "The approved agent config is .baseline/agent.config.json. workspace/ holds the project and must stay intact; the decoy sensor (batman-decoy-sensor) must keep running.",
    ],
    checks: ["Agent's leftover background process stopped", "Agent suspended", "Decoy key revoked", "Outbound traffic blocked", "Agent config restored", "Evidence preserved in forensics/", "Project tests still pass", "Decoy sensor still running"],
    evidence: inv.evidence, drasticFloor: true, fallback,
  }, agentChecks, "Suspend the agent, stop its leftover process, revoke the key, block its outbound traffic (simulated), restore its config");
}
