import { applyFix } from "./apply.js";
import { audit, mustGet, update } from "./run.js";
import { lookupCaller } from "./core.js";

/** Analyst declines the fix: nothing is applied and the ticket closes as fix_rejected. */
export async function reject(incidentId: string, fromPhone: string): Promise<void> {
  const caller = lookupCaller(fromPhone);
  if (!caller || caller.role !== "analyst") {
    audit("approval.denied", `${fromPhone} is not an analyst`, "system");
    throw new Error("only a security analyst can reject");
  }
  const incident = mustGet(incidentId);
  if (incident.status !== "awaiting_approval") throw new Error(`incident is ${incident.status}, not awaiting approval`);
  audit("approval.rejected", `${caller.name} rejected the fix for ${incidentId}`, caller.name);
  update(incident, {
    status: "fix_rejected",
    technicalSummary: incident.technicalSummary + ` Analyst ${caller.name} rejected the proposed fix; nothing was applied.`,
    businessSummary: incident.businessSummary + " The security analyst declined the proposed fix, so nothing on the live system was changed.",
  });
}

/** Called by the inbound-SMS handler (Photon) once it exists, and by POST /defense/approve. */
export async function approve(incidentId: string, fromPhone: string): Promise<void> {
  const caller = lookupCaller(fromPhone);
  if (!caller || caller.role !== "analyst") {
    audit("approval.denied", `${fromPhone} is not an analyst`, "system");
    throw new Error("only a security analyst can approve");
  }
  const incident = mustGet(incidentId);
  if (incident.status !== "awaiting_approval" || !incident.proposedFix) throw new Error(`incident is ${incident.status}, not awaiting approval`);
  audit("approval.granted", `${caller.name} approved ${incidentId}`, caller.name);
  update(incident, { proposedFix: { ...incident.proposedFix, approvedBy: caller.name } });
  await applyFix(incidentId);
}
