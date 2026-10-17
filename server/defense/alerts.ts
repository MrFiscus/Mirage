import type { Incident } from "./contracts";
import type { Telemetry } from "./telemetry";

const KNOWN_DESTINATIONS = ["10.0.0.5"];

export interface Signals {
  rogueProcess: boolean;
  unknownOutbound: string[];
  cronPersistence: boolean;
  integrityFailed: boolean;
}

export function signalsFrom(t: Telemetry): Signals {
  return {
    rogueProcess: t.processes.length > 0,
    unknownOutbound: t.outbound.filter((l) => !KNOWN_DESTINATIONS.some((ip) => l.includes(ip + ":"))),
    cronPersistence: t.cron.length > 0,
    integrityFailed: t.health.some((c) => c.name === "key files intact" && !c.passed),
  };
}

export const signalCount = (s: Signals) =>
  Number(s.rogueProcess) + Number(s.unknownOutbound.length > 0) + Number(s.cronPersistence) + Number(s.integrityFailed);

/** Returns a fresh `detected` Incident if any threat signal is present, else null. */
export function detect(t: Telemetry, id: string): Incident | null {
  const s = signalsFrom(t);
  if (signalCount(s) === 0) return null;
  return {
    id,
    title: "Suspicious activity on acme-payroll-01",
    status: "detected",
    severity: "low",
    confidence: 0,
    evidence: [],
    technicalSummary: "Alert raised; investigation pending.",
    businessSummary: "An alert was raised on a company machine. Investigation is starting.",
  };
}
