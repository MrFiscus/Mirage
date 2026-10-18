import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { RunSummary } from "../../shared/types.js";

export interface ProvenanceRecord {
  session: string;
  attacker: "scripted" | "droid" | "grok";
  triggerStep: number;
  triggerReason: string;
  ts: number;
}

export interface SignedProvenance {
  record: ProvenanceRecord;
  fingerprint: string;
  sig: string;
}

const records = new Map<string, SignedProvenance>();
const MAX_RECORDS = 2000;

function key(): string {
  const secret = process.env.PROVENANCE_SECRET || process.env.VOICE_WEBHOOK_SECRET;
  if (!secret) throw new Error("PROVENANCE_SECRET or VOICE_WEBHOOK_SECRET is required to sign run provenance");
  return secret;
}

function canonical(record: ProvenanceRecord): string {
  return JSON.stringify({
    session: record.session,
    attacker: record.attacker,
    triggerStep: record.triggerStep,
    triggerReason: record.triggerReason,
    ts: record.ts
  });
}

export function sign(record: ProvenanceRecord): SignedProvenance {
  const fingerprint = createHash("sha256").update(canonical(record)).digest("hex");
  const sig = createHmac("sha256", key()).update(fingerprint).digest("hex");
  return { record: { ...record }, fingerprint, sig };
}

export function verify(signed: SignedProvenance): boolean {
  try {
    const expected = sign(signed.record);
    const fingerprint = Buffer.from(signed.fingerprint, "hex");
    const expectedFingerprint = Buffer.from(expected.fingerprint, "hex");
    const signature = Buffer.from(signed.sig, "hex");
    const expectedSignature = Buffer.from(expected.sig, "hex");
    return fingerprint.length === expectedFingerprint.length && signature.length === expectedSignature.length
      && timingSafeEqual(fingerprint, expectedFingerprint) && timingSafeEqual(signature, expectedSignature);
  } catch { return false; }
}

export function getProvenance(session: string): SignedProvenance | undefined {
  return records.get(session);
}

export function signTrigger(record: ProvenanceRecord): SignedProvenance {
  const prior = records.get(record.session);
  if (prior) return prior;
  const signed = sign(record);
  records.set(record.session, signed);
  if (records.size > MAX_RECORDS) records.delete(records.keys().next().value!);
  return signed;
}

export function signSummary(summary: RunSummary): SignedProvenance | undefined {
  if (!summary.triggered || summary.triggerStep === undefined) return undefined;
  return signTrigger({
    session: summary.session,
    attacker: summary.attacker,
    triggerStep: summary.triggerStep,
    triggerReason: summary.triggerReason ?? "watcher intercepted an out-of-scope action",
    ts: summary.ts
  });
}
