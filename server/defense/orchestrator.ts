import { detect, signalsFrom } from "./alerts.js";
import { isPlaybook, runPlaybook } from "./playbooks.js";
import { runAgentPlaybook } from "./agent-playbook.js";
import { applyFix } from "./apply.js";
import { notifyAnalyst } from "./notify.js";
import { runCloneCheck } from "./clonecheck.js";
import { decide } from "./decision.js";
import type { Investigator } from "./investigator.js";
import { createInvestigator } from "./investigators.js";
import { ScriptedPlanner, type FixPlanner } from "./planner.js";
import { planWithDroid, type PlanResult } from "./droid.js";
import { createCompanyMachine, VIRUS_PATH, type Sandbox } from "./sandbox/index.js";
import { audit, lastStepKind, runs, timed, traceStart, traceStep, update } from "./run.js";
import { collectTelemetry, QUERIES, type Telemetry } from "./telemetry.js";
import { severityFloor } from "./investigator.js";
import type { Incident } from "./contracts.js";

export interface ScenarioDeps {
  investigator?: Investigator;
  planner?: FixPlanner;
}

export const newIncidentId = (scenario: string) => `inc-${scenario}-${Date.now().toString(36)}`;

const RUN_LIMIT_MS = 180_000;

/** Runs the loop up to the decision. Returns the incident; if it is awaiting_approval, call approve() next. */
export async function startScenario(scenario: string, deps: ScenarioDeps = {}, id = newIncidentId(scenario)): Promise<Incident> {
  traceStart(id);
  traceStep(id, "started", { tier: scenario });
  const machines: Sandbox[] = [];
  let timer: NodeJS.Timeout | undefined;
  try {
    const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`timed out after ${RUN_LIMIT_MS / 1000} s, during "${lastStepKind(id)}"`)), RUN_LIMIT_MS); });
    return await Promise.race([runScenario(scenario, deps, id, machines), limit]);
  } catch (e) {
    // Record where it failed, then delete every machine this run created so nothing is left running.
    traceStep(id, "failed", { message: (e as Error).message, after: lastStepKind(id) });
    runs.delete(id);
    await Promise.all(machines.map((m) => m.destroy().catch(() => undefined)));
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function runScenario(scenario: string, deps: ScenarioDeps, id: string, machines: Sandbox[]): Promise<Incident> {
  // Demo tiers run on "Robin's PC"; the numbered and virus-* scenarios use the server attack below.
  if (isPlaybook(scenario)) return runPlaybook(scenario, id, machines);
  if (scenario === "agent") return runAgentPlaybook(id, machines);
  const investigator = deps.investigator ?? createInvestigator();
  const planner = deps.planner ?? new ScriptedPlanner();

  const company = await timed(id, "machine.created", () => createCompanyMachine(), (m) => ({ id: m.id, backend: process.env.SANDBOX_BACKEND === "daytona" ? "daytona" : "local" }));
  machines.push(company);
  audit("scenario.start", `scenario ${scenario}; company machine ${company.id} created`);
  const baseline = await collectTelemetry(company);
  const unhealthy = baseline.health.filter((c) => !c.passed);
  if (unhealthy.length) throw new Error(`company machine unhealthy before the attack: ${unhealthy.map((c) => `${c.name} (${c.detail ?? "failed"})`).join("; ")}`);

  await timed(id, "threat.started", () => company.runScript(VIRUS_PATH, scenario === "virus-low" ? "low" : ""), () => ({ tier: scenario })); // the simulated attack
  audit("sim.virus", "harmless simulated virus executed on company machine", "simulator");

  const telemetry = await timed(id, "queries", () => collectTelemetry(company), (t) => ({ queries: describeQueries(t) }));
  logQueries(telemetry);
  const incident = detect(telemetry, id);
  if (!incident) throw new Error("no alert raised");
  runs.set(incident.id, { company });
  update(incident, {});
  traceStep(id, "alert", { title: incident.title });

  update(incident, { status: "investigating" });
  const { engine, trace, ...inv } = await investigator.investigate(telemetry);
  update(incident, inv);
  audit("investigation.done", `${engine ?? "investigator"}: severity ${inv.severity}, confidence ${inv.confidence}, ${inv.evidence.length} evidence items`);
  traceStep(id, "investigation", { engine, trace, severity: inv.severity, confidence: inv.confidence, evidence: inv.evidence, floor: severityFloor(telemetry) }, trace?.ms);

  audit("voice.briefing_ready", "phone briefing updated for this incident");
  const planned = await timed(id, "plan", () => planFix(scenario, planner, !deps.planner, inv.evidence),
    (r) => ({ planner: r.engine === "droid" ? "Factory Droid" : planner.name ?? "planner", engine: r.engine, commands: r.plan.commands, drastic: r.plan.drastic, rationale: r.rationale, note: r.note }));
  const plan = planned.plan;
  const plannerName = planned.engine === "droid" ? "Factory Droid" : planner.name ?? "planner";
  audit("fix.planned", `${plannerName}: ${plan.commands.length} step${plan.commands.length === 1 ? "" : "s"}, ${plan.drastic ? "major change" : "minor change"}${planned.note ? `; ${planned.note}` : ""}`);
  update(incident, { status: "testing_fix", proposedFix: plan });
  const clone = await timed(id, "clone.created", () => company.clone(), (c) => ({ id: c.id }));
  machines.push(clone);
  runs.get(incident.id)!.clone = clone;
  audit("clone.created", `clone ${clone.id} created`);
  const report = await timed(id, "clone.checked", () => runCloneCheck(clone, plan.commands), (r) => ({ before: r.before, checks: r.cloneCheck.checks, passed: r.cloneCheck.passed, remaining: r.remaining, commandFailures: r.commandFailures }));
  const failedBefore = report.before.filter((c) => !c.passed).map((c) => c.name);
  audit("clone.checked", `before fix failing: [${failedBefore.join(", ")}]; after fix passed=${report.cloneCheck.passed}${report.remaining.length ? `; still present: ${report.remaining.join(" | ")}` : ""}${report.commandFailures.length ? `; failed: ${report.commandFailures.join(" | ")}` : ""}`);
  const checked = { ...plan, cloneCheck: report.cloneCheck };
  update(incident, { proposedFix: checked });
  await clone.destroy();
  traceStep(id, "clone.destroyed", { id: clone.id });

  const decision = decide(checked);
  audit("decision", `${decision.action}: ${decision.reason}`);
  traceStep(id, "decision", { action: decision.action, reason: decision.reason, passed: report.cloneCheck.passed, drastic: plan.drastic });
  if (decision.action === "reject") {
    update(incident, {
      status: "fix_rejected",
      technicalSummary: incident.technicalSummary + ` Proposed fix rejected: ${decision.reason}. The company machine was not changed.`,
      businessSummary: incident.businessSummary + " A proposed fix was tested on a copy and rejected because it would have broken the application. The live system was not changed.",
    });
    await notifyAnalyst(incident);
  } else if (decision.action === "await_approval") {
    update(incident, { status: "awaiting_approval" });
    await notifyAnalyst(incident);
  } else {
    await applyFix(incident.id);
  }
  return incident;
}

/**
 * Droid writes the fix from the evidence when configured; the scripted plan is the fallback and sets the minimum
 * "major change" level. Scenario 2 is the deliberately harmful plan the clone check must catch, so it stays scripted.
 */
async function planFix(scenario: string, planner: FixPlanner, useDroid: boolean, evidence: string[]): Promise<PlanResult> {
  const fallback = await planner.plan(scenario);
  if (!useDroid || scenario === "2") return { plan: fallback, engine: "scripted", note: scenario === "2" ? "deliberately harmful plan for the clone-check demo" : undefined };
  const low = scenario === "virus-low";
  return planWithDroid({
    goal: low ? "Remove the unapproved scheduled task from this server." : "Remove the simulated intrusion from this server and restore it to its known-good state.",
    machine: low
      ? ["Scheduled tasks are files in cron/; approved ones were there before the alert."]
      : [
          "The unknown program's process id is stored in .run/rogue.pid; stop it and remove that file.",
          "lib.cjs was modified; the known-good copy is .baseline/lib.cjs.",
          "logs/network.log contains beacon lines to 10.0.0.99; remove only those lines and keep the rest (no sed -i; use grep -v into a temp file then mv; grep -v exits 1 when nothing is left).",
          "cron/ holds scheduled task files; remove the one that beacons out.",
        ],
    checks: ["App starts", "App tests pass", "Key files match their known-good copies", "No unknown program running", "No outbound lines to unknown addresses in logs/network.log", "No unapproved scheduled task in cron/"],
    evidence, drasticFloor: fallback.drastic, fallback,
  });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The exact read-only commands and what each found, for the explain view. */
function describeQueries(t: Telemetry) {
  const s = signalsFrom(t);
  return [
    { name: "Running programs", command: QUERIES.processes, found: t.processes },
    { name: "Network log", command: QUERIES.outbound, found: s.unknownOutbound, note: `${t.outbound.length} outbound line(s), ${s.unknownOutbound.length} to unknown addresses` },
    { name: "Scheduled tasks", command: QUERIES.cron, found: t.cron },
    { name: "App health", command: QUERIES.health, found: t.health.filter((c) => !c.passed).map((c) => `${c.name}: ${c.detail ?? "failed"}`) },
  ];
}

/** One audit line per read-only query, worded for the demo feed. */
function logQueries(t: Telemetry): void {
  const s = signalsFrom(t);
  audit("query.processes", t.processes.length ? `${plural(t.processes.length, "unexpected program", "unexpected programs")} running` : "nothing unusual running");
  audit("query.network", s.unknownOutbound.length ? `${plural(s.unknownOutbound.length, "connection", "connections")} to an unknown address` : "no connections to unknown addresses");
  audit("query.schedule", t.cron.length ? `${plural(t.cron.length, "scheduled task", "scheduled tasks")} not approved by IT` : "no unapproved scheduled tasks");
  const FAILED: Record<string, string> = { "app starts": "the app won't start", "tests pass": "the app's tests fail", "key files intact": "key application files were changed" };
  const failing = t.health.filter((c) => !c.passed).map((c) => FAILED[c.name] ?? c.name);
  audit("query.health", failing.length ? failing.join(", ") : "app healthy, key files unchanged");
}

export async function cleanup(incidentId: string): Promise<void> {
  const ctx = runs.get(incidentId);
  await ctx?.company.destroy();
  runs.delete(incidentId);
}
