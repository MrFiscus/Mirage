import type { FixPlan } from "./contracts.js";
import type { Sandbox } from "./sandbox/index.js";
import { signalCount, signalsFrom } from "./alerts.js";
import { collectHealth, collectTelemetry, type HealthCheck } from "./telemetry.js";

export interface CloneCheckReport {
  cloneCheck: NonNullable<FixPlan["cloneCheck"]>;
  before: HealthCheck[];
  commandFailures: string[];
  remaining: string[];   // threat indicators still present on the clone after the fix
}

/** Runs the fix on a clone, with health checks before and after, then a threat re-scan. */
export async function runCloneCheck(clone: Sandbox, commands: string[]): Promise<CloneCheckReport> {
  const before = await collectHealth(clone);
  const commandFailures: string[] = [];
  for (const cmd of commands) {
    const r = await clone.exec(cmd);
    if (r.code !== 0) { commandFailures.push(`${cmd} (exit ${r.code})`); break; }
  }
  const after = await collectTelemetry(clone);
  const s = signalsFrom(after);
  const remaining = [
    ...(s.rogueProcess ? after.processes.map((l) => `program still running: ${l}`) : []),
    ...s.unknownOutbound.map((l) => `connection still logged: ${l}`),
    ...after.cron.map((l) => `scheduled task still present: ${l}`),
    ...(s.integrityFailed ? ["key files still changed"] : []),
  ];
  const checks = [
    ...after.health.map((c) => ({ name: c.name, passed: c.passed })),
    { name: "no threat indicators remain", passed: signalCount(signalsFrom(after)) === 0 },
    { name: "fix commands succeeded", passed: commandFailures.length === 0 },
  ];
  return { cloneCheck: { passed: checks.every((c) => c.passed), checks }, before, commandFailures, remaining };
}
