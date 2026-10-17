import type { FixPlan } from "./contracts";

export type Decision = { action: "apply" | "await_approval" | "reject"; reason: string };

/** Failed clone check always rejects. Drastic fixes always need a human. Only low risk + passed auto-applies. */
export function decide(plan: FixPlan): Decision {
  if (plan.cloneCheck?.passed !== true) {
    const failed = plan.cloneCheck?.checks.filter((c) => !c.passed).map((c) => c.name) ?? ["clone check did not run"];
    return { action: "reject", reason: `failed clone checks: ${failed.join(", ")}` };
  }
  if (plan.drastic) return { action: "await_approval", reason: "drastic fix; passed the clone's health checks; needs analyst approval" };
  return { action: "apply", reason: "low risk and passed the clone's health checks" };
}
