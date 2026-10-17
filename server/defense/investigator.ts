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

/**
 * Serious signals: a running unknown program, contact with an unknown address, changed key files.
 * Two or more together is high; one is medium; only an unapproved scheduled task is low.
 * A scheduled task adds persistence (and confidence) but never raises the tier on its own.
 */
export function seriousSignals(t: Telemetry): number {
  const s = signalsFrom(t);
  return Number(s.rogueProcess) + Number(s.unknownOutbound.length > 0) + Number(s.integrityFailed);
}

const ORDER: Incident["severity"][] = ["low", "medium", "high"];

/** Severity justified by what was observed. The rules investigator uses it as is; Gemini may only raise it. */
export function severityFloor(t: Telemetry): Incident["severity"] {
  const serious = seriousSignals(t);
  return serious >= 2 ? "high" : serious === 1 ? "medium" : "low";
}
export const maxSeverity = (a: Incident["severity"], b: Incident["severity"]) => (ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b);

// What a summary sentence claims, and the signal that must be present for the claim to be supported.
const CLAIMS: { pattern: RegExp; present: (s: ReturnType<typeof signalsFrom>) => boolean; what: string }[] = [
  { pattern: /\bprogram\b|\bprocess\b/i, present: (s) => s.rogueProcess, what: "a running program" },
  { pattern: /\bcontact|\baddress\b|\bconnection\b|\bbeacon/i, present: (s) => s.unknownOutbound.length > 0, what: "outside contact" },
  { pattern: /\bscheduled\b|\bcron\b|come back/i, present: (s) => s.cronPersistence, what: "a scheduled task" },
  { pattern: /\bfile/i, present: (s) => s.integrityFailed, what: "changed files" },
];

/** Claims in `text` that the telemetry does not support. Parenthesised text is treated as a legend, not a claim. */
export function unsupportedClaims(text: string, t: Telemetry): string[] {
  const s = signalsFrom(t);
  const out = new Set<string>();
  for (const sentence of text.split(/(?<=\.)\s+/)) {
    const claimText = sentence.replace(/\([^)]*\)/g, "");
    for (const c of CLAIMS) if (c.pattern.test(claimText) && !c.present(s)) out.add(c.what);
  }
  return [...out];
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
    const serious = seriousSignals(t);
    const persistence = signalsFrom(t).cronPersistence;
    const severity = severityFloor(t);
    const confidence = Math.min(0.97, Number((0.5 + 0.15 * serious + (persistence ? 0.05 : 0)).toFixed(2)));
    return {
      engine: "rules", severity, confidence, evidence,
      technicalSummary: `${n} of 4 indicators present (process, outbound, cron persistence, file integrity); ${serious} serious (program, outbound, file integrity). Findings: ${findings.join("; ")}. Evidence is cited below. Data loss has not been confirmed by any query.`,
      businessSummary: `${plainFindings(t)} We have not confirmed any data loss. Batman is testing a fix on a copy of the machine first; nothing on the live system changes until that test passes.`,
    };
  }
}
