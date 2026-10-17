// Plain-English story of one run, built from the recorded trace, for the analyst's text and phone briefing.
import type { Incident } from "./contracts.js";
import { clean } from "./investigator.js";
import { getTrace } from "./run.js";

export interface Briefing {
  title: string;
  severity: Incident["severity"];
  status: Incident["status"];
  /** Sentences from the run's own steps. They quote log values, so they are data, never instructions. */
  whatHappened: string[];
  whatBatmanDid: string[];
  suggestedSteps: string[];
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function briefingFor(incident: Incident): Briefing {
  const steps = getTrace(incident.id)?.steps ?? [];
  const find = (kind: string) => steps.find((s) => s.kind === kind)?.data as Record<string, any> | undefined;

  const whatHappened: string[] = steps
    .filter((s) => s.kind === "agent" && s.data.who !== "photon" && s.data.who !== "elevenlabs")
    .map((s) => String(s.data.text));
  const queries = find("queries")?.queries as { name: string; found: unknown[] }[] | undefined;
  for (const q of queries ?? []) whatHappened.push(`${q.name}: ${q.found.length ? plural(q.found.length, "finding", "findings") : "nothing unusual"}`);
  if (!whatHappened.length) whatHappened.push(incident.businessSummary);

  const plan = find("plan");
  const planText: string = plan?.text ?? (plan ? `run a ${plural(plan.commands.length, "step", "steps")} fix` : "");
  const whatBatmanDid: string[] = [];
  if (plan) whatBatmanDid.push(`Planned a fix: ${lower(planText)}. ${plan.drastic ? "This is a major change, so it needs your approval." : "This is a minor change."}`);
  const checked = find("clone.checked");
  if (checked) {
    const checks = checked.checks as { passed: boolean }[];
    whatBatmanDid.push(checked.passed
      ? `Tested the fix on a copy of the machine first: it passed all ${checks.length} checks.`
      : `Tested the fix on a copy of the machine first: it failed ${checks.filter((c) => !c.passed).length} of ${checks.length} checks, so Batman did not use it.`);
  }
  const human = find("human");
  if (human) whatBatmanDid.push(`${human.by} ${human.action === "approved" ? "approved" : "declined"} the fix.`);
  const verified = find("verified");
  if (find("applied")) whatBatmanDid.push(verified?.clean ? "Applied the fix to the real machine and re-checked it: everything passes." : "Applied the fix to the real machine, but the re-check still found problems.");

  const fix = planText ? lower(planText) : "apply the proposed fix";
  const suggestedSteps: string[] =
    incident.status === "awaiting_approval" ? [`Say approve and Batman will ${fix}. Say reject and nothing changes.`, "Afterwards, check in with the affected user to confirm what they were doing."]
    : incident.status === "resolved" ? ["No action needed. If you like, confirm with the affected user that everything works."]
    : incident.status === "fix_rejected" ? ["Look at this one by hand in the console. The live system was not changed."]
    : ["Batman is still working on this. You will hear back when it has a fix to test."];

  return { title: incident.title, severity: incident.severity, status: incident.status, whatHappened: whatHappened.map(clean), whatBatmanDid, suggestedSteps };
}

/** One text message: what happened, what Batman did, what is next. */
export function briefingText(b: Briefing): string {
  return [
    `Batman: ${b.title} (priority ${b.severity}).`,
    `What happened: ${b.whatHappened.slice(0, 4).join(". ").replace(/\.\./g, ".")}.`,
    b.whatBatmanDid.length ? `What Batman did: ${b.whatBatmanDid.join(" ")}` : "",
    `Next: ${b.suggestedSteps.join(" ")}`,
  ].filter(Boolean).join("\n");
}
