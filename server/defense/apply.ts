import { signalCount, signalsFrom } from "./alerts.js";
import { collectTelemetry } from "./telemetry.js";
import { audit, mustGet, runs, update } from "./run.js";
import { sendSms } from "./core.js";

export const analystPhone = () => process.env.ANALYST_PHONE ?? "+15550001002";

/** Applies the already clone-checked plan to the company machine, then verifies it is clean. */
export async function applyFix(incidentId: string): Promise<void> {
  const incident = mustGet(incidentId);
  const ctx = runs.get(incidentId);
  const plan = incident.proposedFix;
  if (!ctx || !plan) throw new Error("nothing to apply");
  if (plan.cloneCheck?.passed !== true) throw new Error("refusing to apply a fix that did not pass the clone check");
  if (plan.drastic && !plan.approvedBy) throw new Error("refusing to apply a drastic fix without approval");

  audit("fix.apply", `running ${plan.commands.length} commands on company machine`);
  for (const cmd of plan.commands) {
    const r = await ctx.company.exec(cmd);
    if (r.code !== 0) {
      update(incident, { status: "fix_rejected", technicalSummary: incident.technicalSummary + ` Applying the fix failed at "${cmd}" (exit ${r.code}).` });
      audit("fix.apply_failed", cmd);
      return;
    }
  }
  const after = await collectTelemetry(ctx.company);
  const clean = signalCount(signalsFrom(after)) === 0 && after.health.every((c) => c.passed);
  audit("fix.verify", clean ? "company machine verified clean" : "verification found remaining issues");
  if (!clean) {
    update(incident, { status: "fix_rejected", technicalSummary: incident.technicalSummary + " Post-fix verification still found issues." });
    return;
  }
  update(incident, {
    status: "resolved",
    technicalSummary: incident.technicalSummary + " Fix applied; post-fix health checks and threat re-scan are clean.",
    businessSummary: incident.businessSummary + " The issue is resolved and the system is verified healthy.",
  });
  sendSms(analystPhone(), `Batman: ${incident.id} resolved. Fix applied and verified clean.`);
}
