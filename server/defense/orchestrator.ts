import { detect, signalsFrom } from "./alerts.js";
import { applyFix, analystPhone } from "./apply.js";
import { runCloneCheck } from "./clonecheck.js";
import { decide } from "./decision.js";
import type { Investigator } from "./investigator.js";
import { createInvestigator } from "./investigators.js";
import { ScriptedPlanner, type FixPlanner } from "./planner.js";
import { createCompanyMachine, VIRUS_PATH } from "./sandbox/index.js";
import { audit, runs, update } from "./run.js";
import { sendSms } from "./core.js";
import { collectTelemetry, type Telemetry } from "./telemetry.js";
import type { Incident } from "./contracts.js";

export interface ScenarioDeps {
  investigator?: Investigator;
  planner?: FixPlanner;
}

export const newIncidentId = (scenario: string) => `inc-${scenario}-${Date.now().toString(36)}`;

/** Runs the loop up to the decision. Returns the incident; if it is awaiting_approval, call approve() next. */
export async function startScenario(scenario: string, deps: ScenarioDeps = {}, id = newIncidentId(scenario)): Promise<Incident> {
  const investigator = deps.investigator ?? createInvestigator();
  const planner = deps.planner ?? new ScriptedPlanner();

  const company = await createCompanyMachine();
  audit("scenario.start", `scenario ${scenario}; company machine ${company.id} created`);
  const baseline = await collectTelemetry(company);
  const unhealthy = baseline.health.filter((c) => !c.passed);
  if (unhealthy.length) throw new Error(`company machine unhealthy before the attack: ${unhealthy.map((c) => `${c.name} (${c.detail ?? "failed"})`).join("; ")}`);

  await company.runScript(VIRUS_PATH, scenario === "low" ? "low" : ""); // the simulated attack
  audit("sim.virus", "harmless simulated virus executed on company machine", "simulator");

  const telemetry = await collectTelemetry(company);
  logQueries(telemetry);
  const incident = detect(telemetry, id);
  if (!incident) throw new Error("no alert raised");
  runs.set(incident.id, { company });
  update(incident, {});

  update(incident, { status: "investigating" });
  const { engine, ...inv } = await investigator.investigate(telemetry);
  update(incident, inv);
  audit("investigation.done", `${engine ?? "investigator"}: severity ${inv.severity}, confidence ${inv.confidence}, ${inv.evidence.length} evidence items`);

  audit("voice.briefing_ready", "phone briefing updated for this incident");
  const plan = await planner.plan(scenario);
  audit("fix.planned", `${planner.name ?? "planner"}: ${plan.commands.length} step${plan.commands.length === 1 ? "" : "s"}, ${plan.drastic ? "major change" : "minor change"}`);
  update(incident, { status: "testing_fix", proposedFix: plan });
  const clone = await company.clone();
  runs.get(incident.id)!.clone = clone;
  audit("clone.created", `clone ${clone.id} created`);
  const report = await runCloneCheck(clone, plan.commands);
  const failedBefore = report.before.filter((c) => !c.passed).map((c) => c.name);
  audit("clone.checked", `before fix failing: [${failedBefore.join(", ")}]; after fix passed=${report.cloneCheck.passed}`);
  const checked = { ...plan, cloneCheck: report.cloneCheck };
  update(incident, { proposedFix: checked });
  await clone.destroy();

  const decision = decide(checked);
  audit("decision", `${decision.action}: ${decision.reason}`);
  if (decision.action === "reject") {
    update(incident, {
      status: "fix_rejected",
      technicalSummary: incident.technicalSummary + ` Proposed fix rejected: ${decision.reason}. The company machine was not changed.`,
      businessSummary: incident.businessSummary + " A proposed fix was tested on a copy and rejected because it would have broken the application. The live system was not changed.",
    });
    sendSms(analystPhone(), `Batman: fix for ${incident.id} REJECTED, ${decision.reason}. Live system untouched.`);
  } else if (decision.action === "await_approval") {
    update(incident, { status: "awaiting_approval" });
    const n = checked.cloneCheck!.checks.length;
    sendSms(analystPhone(), `Batman: ${incident.title}. Severity ${incident.severity}, confidence ${Math.round(incident.confidence * 100)}%. Fix passed the clone's health checks (${n}/${n}). Reply APPROVE ${incident.id} to apply.`);
  } else {
    await applyFix(incident.id);
  }
  return incident;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

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
