import { detect } from "./alerts.js";
import { applyFix, analystPhone } from "./apply.js";
import { runCloneCheck } from "./clonecheck.js";
import { decide } from "./decision.js";
import { RuleInvestigator, type Investigator } from "./investigator.js";
import { ScriptedPlanner, type FixPlanner } from "./planner.js";
import { createCompanyMachine, VIRUS_PATH } from "./sandbox/index.js";
import { audit, runs, update } from "./run.js";
import { sendSms } from "./core.js";
import { collectTelemetry } from "./telemetry.js";
import type { Incident } from "./contracts.js";

export interface ScenarioDeps {
  investigator?: Investigator;
  planner?: FixPlanner;
}

export const newIncidentId = (scenario: string) => `inc-${scenario}-${Date.now().toString(36)}`;

/** Runs the loop up to the decision. Returns the incident; if it is awaiting_approval, call approve() next. */
export async function startScenario(scenario: string, deps: ScenarioDeps = {}, id = newIncidentId(scenario)): Promise<Incident> {
  const investigator = deps.investigator ?? new RuleInvestigator();
  const planner = deps.planner ?? new ScriptedPlanner();

  const company = await createCompanyMachine();
  audit("scenario.start", `scenario ${scenario}; company machine ${company.id} created`);
  const baseline = await collectTelemetry(company);
  if (!baseline.health.every((c) => c.passed)) throw new Error("company machine unhealthy before the attack");

  await company.runScript(VIRUS_PATH); // the simulated attack
  audit("sim.virus", "harmless simulated virus executed on company machine", "simulator");

  const telemetry = await collectTelemetry(company);
  const incident = detect(telemetry, id);
  if (!incident) throw new Error("no alert raised");
  runs.set(incident.id, { company });
  update(incident, {});

  update(incident, { status: "investigating" });
  const inv = await investigator.investigate(telemetry);
  update(incident, { ...inv });
  audit("investigation.done", `severity ${inv.severity}, confidence ${inv.confidence}, ${inv.evidence.length} evidence items`);

  const plan = await planner.plan(scenario);
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

export async function cleanup(incidentId: string): Promise<void> {
  const ctx = runs.get(incidentId);
  await ctx?.company.destroy();
  runs.delete(incidentId);
}
