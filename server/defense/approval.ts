import { applyFix } from "./apply.js";
import { audit, mustGet, update } from "./run.js";
import { lookupCaller } from "./mocks/core.js";

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
