import type { FixPlan, Incident } from "./contracts.js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { emit, getIncident, saveIncident } from "./core.js";
import type { Sandbox } from "./sandbox/index.js";

/** Live state for an incident between "awaiting approval" and "applied". */
export interface RunContext {
  company: Sandbox; clone?: Sandbox; plan?: FixPlan;
  /** Scenario-specific re-check after applying; defaults to the server threat scan. */
  verify?: (sb: Sandbox) => Promise<{ name: string; passed: boolean; detail?: string }[]>;
}
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
const traceRoot = resolve(process.cwd(), "data", "defense-traces");
const tracePath = (id: string) => /^[A-Za-z0-9_-]+$/.test(id) ? resolve(traceRoot, `${id}.json`) : null;
function persistTrace(id: string): void {
  const path = tracePath(id);
  const trace = traces.get(id);
  if (!path || !trace) return;
  mkdirSync(traceRoot, { recursive: true });
  writeFileSync(path, JSON.stringify(trace, null, 2));
}

export function traceStart(id: string): void { traces.set(id, { startedAt: Date.now(), steps: [] }); persistTrace(id); }
export function traceStep(id: string, kind: string, data: Record<string, unknown> = {}, ms?: number): void {
  const t = traces.get(id);
  t?.steps.push({ kind, at: Date.now(), ms, data });
  persistTrace(id);
  // Visible in the `npm run dev` terminal, so a stalled run shows where it stopped.
  console.log(`[batman] ${id} ${t ? `+${((Date.now() - t.startedAt) / 1000).toFixed(1)}s` : ""} ${kind}${ms != null ? ` (${ms} ms)` : ""}${kind === "failed" ? `: ${String(data.message)}` : ""}`);
}
export const lastStepKind = (id: string) => traces.get(id)?.steps.at(-1)?.kind ?? "start";
export function getTrace(id: string): { startedAt: number; steps: TraceStep[] } | undefined {
  const path = tracePath(id);
  if (traces.has(id)) return traces.get(id);
  if (!path) return undefined;
  try { return JSON.parse(readFileSync(path, "utf8")) as { startedAt: number; steps: TraceStep[] }; }
  catch { return undefined; }
}

/** Times an async step and records it. */
export async function timed<T>(id: string, kind: string, fn: () => Promise<T>, data: (r: T) => Record<string, unknown> = () => ({})): Promise<T> {
  const t = Date.now();
  const r = await fn();
  traceStep(id, kind, data(r), Date.now() - t);
  return r;
}
