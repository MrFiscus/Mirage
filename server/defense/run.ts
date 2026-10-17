import type { FixPlan, Incident } from "./contracts";
import { emit, getIncident, saveIncident } from "./mocks/core";
import type { Sandbox } from "./sandbox";

/** Live state for an incident between "awaiting approval" and "applied". */
export interface RunContext { company: Sandbox; clone?: Sandbox; plan?: FixPlan; }
export const runs = new Map<string, RunContext>();

export function audit(action: string, detail: string, actor = "batman") {
  emit({ type: "audit", actor, action, detail, ts: Date.now() });
}

export function update(incident: Incident, patch: Partial<Incident>): Incident {
  Object.assign(incident, patch);
  saveIncident(incident);
  emit({ type: "incident.updated", incident: structuredClone(incident) });
  return incident;
}

export const mustGet = (id: string): Incident => {
  const i = getIncident(id);
  if (!i) throw new Error(`no such incident: ${id}`);
  return i;
};
