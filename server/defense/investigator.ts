import type { Incident } from "./contracts.js";
import { signalCount, signalsFrom } from "./alerts.js";
import type { Telemetry } from "./telemetry.js";

export interface Investigation {
  severity: Incident["severity"];
  confidence: number;
  evidence: string[];
  technicalSummary: string;
  businessSummary: string;
}

export interface Investigator { investigate(t: Telemetry): Promise<Investigation>; }

/** Log text is untrusted: strip control chars and cap length. It is only ever stored, never executed. */
export const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200);

/** Deterministic rule-based investigator. A Claude investigator can replace it behind the same interface. */
export class RuleInvestigator implements Investigator {
  async investigate(t: Telemetry): Promise<Investigation> {
    const s = signalsFrom(t);
    const n = signalCount(s);
    const evidence: string[] = [];
    const findings: string[] = [];
    if (s.rogueProcess) { evidence.push(...t.processes.map((l) => "process: " + clean(l))); findings.push("an unexpected background process"); }
    if (s.unknownOutbound.length) { evidence.push(...s.unknownOutbound.map((l) => "network.log: " + clean(l))); findings.push("a connection attempt to an unrecognised address"); }
    if (s.cronPersistence) { evidence.push(...t.cron.map((l) => "cron: " + clean(l))); findings.push("a scheduled job that would let it come back"); }
    if (s.integrityFailed) {
      const d = t.health.find((c) => c.name === "key files intact")?.detail ?? "";
      evidence.push("integrity: " + clean(d)); findings.push("a changed application file");
    }
    const severity: Incident["severity"] = n >= 3 ? "high" : n === 2 ? "medium" : "low";
    const confidence = Math.min(0.97, Number((0.4 + 0.15 * n).toFixed(2)));
    return {
      severity, confidence, evidence,
      technicalSummary: `${n} of 4 indicators present (process, outbound, cron persistence, file integrity). Findings: ${findings.join("; ")}. Evidence is cited below. Data loss has not been confirmed by any query.`,
      businessSummary: `One company machine ran an unauthorised program that tried to contact an unknown address. We have not confirmed any data loss. Batman is testing a fix on a copy of the machine first; nothing on the live system changes until that test passes.`,
    };
  }
}
