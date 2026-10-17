import type { Incident } from "./contracts.js";
import { signalCount, signalsFrom } from "./alerts.js";
import type { Telemetry } from "./telemetry.js";

export interface Investigation {
  engine?: string;      // which investigator produced this (audit only, not part of Incident)
  severity: Incident["severity"];
  confidence: number;
  evidence: string[];
  technicalSummary: string;
  businessSummary: string;
}

export interface Investigator { investigate(t: Telemetry): Promise<Investigation>; }

/** Log text is untrusted: strip control chars and cap length. It is only ever stored, never executed. */
export const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200);

export interface Evidence { evidence: string[]; findings: string[]; indicators: number; }

/** Cites exact telemetry lines. Used by both investigators so a model can only point at real evidence. */
export function buildEvidence(t: Telemetry): Evidence {
  const s = signalsFrom(t);
  const evidence: string[] = [];
  const findings: string[] = [];
  if (s.rogueProcess) { evidence.push(...t.processes.map((l) => "process: " + clean(l))); findings.push("an unexpected background process"); }
  if (s.unknownOutbound.length) { evidence.push(...s.unknownOutbound.map((l) => "network.log: " + clean(l))); findings.push("a connection attempt to an unrecognised address"); }
  if (s.cronPersistence) { evidence.push(...t.cron.map((l) => "cron: " + clean(l))); findings.push("a scheduled job that would let it come back"); }
  if (s.integrityFailed) {
    const d = t.health.find((c) => c.name === "key files intact")?.detail ?? "";
    evidence.push("integrity: " + clean(d)); findings.push("a changed application file");
  }
  return { evidence, findings, indicators: signalCount(s) };
}

/** Weighted so a running program that beacons out rates high, while a lone scheduled task stays low. */
export const SIGNAL_WEIGHTS = { unknownOutbound: 3, rogueProcess: 2, integrityFailed: 2, cronPersistence: 1 } as const;

export function weightedScore(t: Telemetry): number {
  const s = signalsFrom(t);
  return (s.unknownOutbound.length ? SIGNAL_WEIGHTS.unknownOutbound : 0)
    + (s.rogueProcess ? SIGNAL_WEIGHTS.rogueProcess : 0)
    + (s.integrityFailed ? SIGNAL_WEIGHTS.integrityFailed : 0)
    + (s.cronPersistence ? SIGNAL_WEIGHTS.cronPersistence : 0);
}

/** CEO-level sentence built only from what was actually found. */
export function plainFindings(t: Telemetry): string {
  const s = signalsFrom(t);
  const parts = [
    ...(s.rogueProcess ? ["an unknown program was running"] : []),
    ...(s.unknownOutbound.length ? ["it tried to contact an outside address IT doesn't recognise"] : []),
    ...(s.cronPersistence ? ["a scheduled task IT didn't approve was added"] : []),
    ...(s.integrityFailed ? ["an application file was changed"] : []),
  ];
  if (!parts.length) return "Nothing unusual was found on the machine.";
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
  return `On one company machine, ${list}.`;
}

/** Deterministic rule-based investigator. Also the fallback whenever the model call fails or misbehaves. */
export class RuleInvestigator implements Investigator {
  async investigate(t: Telemetry): Promise<Investigation> {
    const { evidence, findings, indicators: n } = buildEvidence(t);
    const score = weightedScore(t);
    const severity: Incident["severity"] = score >= 4 ? "high" : score >= 2 ? "medium" : "low";
    const confidence = Math.min(0.97, Number((0.45 + 0.07 * score).toFixed(2)));
    return {
      engine: "rules", severity, confidence, evidence,
      technicalSummary: `${n} of 4 indicators present (process, outbound, cron persistence, file integrity); weighted score ${score} of 8. Findings: ${findings.join("; ")}. Evidence is cited below. Data loss has not been confirmed by any query.`,
      businessSummary: `${plainFindings(t)} We have not confirmed any data loss. Batman is testing a fix on a copy of the machine first; nothing on the live system changes until that test passes.`,
    };
  }
}
