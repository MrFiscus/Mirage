import type { FixPlan, Incident } from "./contracts.js";
import { emit, getIncident, saveIncident } from "./core.js";
import type { Sandbox } from "./sandbox/index.js";

/** Live state for an incident between "awaiting approval" and "applied". */
export interface RunContext { company: Sandbox; clone?: Sandbox; plan?: FixPlan; }
export const runs = new Map<string, RunContext>();

export function audit(action: string, detail: string, actor = "batman") {
  emit({ type: "audit", actor, action, detail, ts: Date.now() });
}

export function update(incident: Incident, patch: Partial<Incident>): Incident {
  Object.assign(incident, patch, { updatedAt: Date.now() });
  saveIncident(incident);
  emit({ type: "incident.updated", incident: structuredClone(incident) });
  return incident;
}

export const mustGet = (id: string): Incident => {
  const i = getIncident(id);
  if (!i) throw new Error(`no such incident: ${id}`);
  return i;
};

/** Step-by-step record of one run, with timings, for the explain view (GET /defense/trace/:id). */
export interface TraceStep { kind: string; at: number; ms?: number; data: Record<string, unknown> }
const traces = new Map<string, { startedAt: number; steps: TraceStep[] }>();

export function traceStart(id: string): void { traces.set(id, { startedAt: Date.now(), steps: [] }); }
export function traceStep(id: string, kind: string, data: Record<string, unknown> = {}, ms?: number): void {
  traces.get(id)?.steps.push({ kind, at: Date.now(), ms, data });
}
export const getTrace = (id: string) => traces.get(id);

/** Times an async step and records it. */
export async function timed<T>(id: string, kind: string, fn: () => Promise<T>, data: (r: T) => Record<string, unknown> = () => ({})): Promise<T> {
  const t = Date.now();
  const r = await fn();
  traceStep(id, kind, data(r), Date.now() - t);
  return r;
}
