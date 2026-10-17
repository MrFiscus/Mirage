import { randomInt, timingSafeEqual } from "node:crypto";
import type { Caller } from "../../shared/types.js";
import { emit } from "../core/events.js";
import { lookupCaller } from "../core/store.js";
import type { SmsSender } from "./photon.js";
import { smsEvent } from "./photon.js";

interface PendingCode {
  code: string;
  expiresAt: number;
  attempts: number;
}

export type VerifyResult = "matched" | "mismatch" | "expired" | "no_code" | "locked";

export const MAX_CODE_ATTEMPTS = 3;
const CODE_TTL_MS = 5 * 60 * 1000;
const pending = new Map<string, PendingCode>();

export class VerificationService {
  constructor(private readonly sms: SmsSender) {}

  async request(phone: string): Promise<{ caller: Caller | null; sent: boolean }> {
    const caller = lookupCaller(phone);
    if (!caller) return { caller: null, sent: false };
    const code = randomInt(100000, 1000000).toString();
    pending.set(phone, { code, expiresAt: Date.now() + CODE_TTL_MS, attempts: 0 });
    await this.sms.send(phone, `Batman verification code: ${code}. It expires in 5 minutes.`);
    // The console is on a shared screen, so the broadcast copy never carries the code.
    emit(smsEvent(phone, "Batman verification code: ••••••. It expires in 5 minutes."));
    emit({ type: "audit", actor: "verification", action: "verification.code_sent", detail: `code sent to ${caller.role}`, ts: Date.now() });
    return { caller, sent: true };
  }

  verify(phone: string, code: string): VerifyResult {
    const record = pending.get(phone);
    if (!record) return "no_code";
    if (record.expiresAt < Date.now()) {
      pending.delete(phone);
      return "expired";
    }
    if (record.attempts >= MAX_CODE_ATTEMPTS) return "locked";
    record.attempts += 1;
    const matched = code.length === record.code.length && timingSafeEqual(Buffer.from(code), Buffer.from(record.code));
    if (!matched) {
      emit({ type: "audit", actor: "verification", action: "verification.failed", detail: `attempt ${record.attempts}/${MAX_CODE_ATTEMPTS}`, ts: Date.now() });
      return record.attempts >= MAX_CODE_ATTEMPTS ? "locked" : "mismatch";
    }
    pending.delete(phone);
    emit({ type: "audit", actor: "verification", action: "verification.succeeded", detail: "server-side code matched", ts: Date.now() });
    return "matched";
  }
}
