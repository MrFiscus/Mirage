import express from "express";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { saveIncident } from "../server/core/store.js";
import { voiceRouter } from "../server/voice/routes.js";
import { VerificationService } from "../server/voice/verification.js";
import type { Incident, Role } from "../shared/types.js";
import type { Metric } from "./metric.js";

const SECRET = "eval-secret";
const PHONES: Record<Exclude<Role, "unknown">, string> = { ceo: "+15550001001", analyst: "+15550001002", hr: "+15550001003", developer: "+15550001004" };
const UNKNOWN = "+15559990000";

// The policy the eval holds the server to. Anything outside a role's set is a leak.
const ALLOWED: Record<Role, string[]> = {
  ceo: ["id", "title", "status", "severity", "businessSummary", "fixState"],
  analyst: ["id", "title", "status", "severity", "confidence", "technicalSummary", "evidenceNote", "evidence", "proposedFix"],
  hr: ["id", "title", "status"],
  developer: ["id", "title", "status"],
  unknown: [],
};

export async function disclosureSuite(): Promise<Metric[]> {
  process.env.VOICE_WEBHOOK_SECRET = SECRET;
  const texts: { to: string; body: string }[] = [];
  const app = express();
  app.use(voiceRouter(new VerificationService({ async send(to, body) { texts.push({ to, body }); } })));
  const server: Server = await new Promise((resolve) => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const incident: Incident = {
    id: "INC-EVAL-1", title: "Eval incident", status: "awaiting_approval", severity: "high", confidence: 0.9,
    evidence: ["network.log: OUTBOUND tcp 10.0.0.99:4444 beacon"], technicalSummary: "TECHNICAL-ONLY detail", businessSummary: "BUSINESS-ONLY detail",
    proposedFix: { commands: ["rm -f cron/beacon.cron"], drastic: true, cloneCheck: { passed: true, checks: [{ name: "app starts", passed: true }] } },
    updatedAt: Date.now() + 1e9,
  };
  saveIncident(incident);
  saveIncident({ ...incident, id: "INC-EVAL-2", title: "Older incident", technicalSummary: "OTHER technical", updatedAt: 1 });

  let n = 0;
  const conv = () => `eval-conv-${++n}`;
  const call = async (tool: string, body: object, secret = SECRET) => {
    const res = await fetch(`${base}/voice/tools/${tool}`, { method: "POST", headers: { "content-type": "application/json", "x-batman-secret": secret }, body: JSON.stringify(body) });
    return { status: res.status, json: (await res.json()) as Record<string, any> };
  };
  const lastCode = (to: string) => /(\d{6})/.exec([...texts].reverse().find((t) => t.to === to)?.body ?? "")?.[1] ?? "000000";
  const verified = async (phone: string) => {
    const id = conv();
    await call("send-code", { conversation_id: id, caller_id: phone });
    await call("verify-code", { conversation_id: id, caller_id: phone, code: lastCode(phone) });
    return id;
  };

  const results: { name: string; ok: boolean; leaked: string[]; why?: string }[] = [];
  const leaks = (role: Role, json: Record<string, any>) => Object.keys(json.incident ?? {}).filter((k) => !ALLOWED[role].includes(k));
  const record = (name: string, ok: boolean, leaked: string[] = [], why?: string) => results.push({ name, ok: ok && leaked.length === 0, leaked, why });

  try {
    for (const [role, phone] of Object.entries(PHONES) as [Role, string][]) {
      const id = conv();
      const r = await call("incident-summary", { conversation_id: id, caller_id: phone });
      record(`${role} unverified is refused`, r.json.allowed === false && !r.json.incident, leaks("unknown", r.json));

      const v = await verified(phone);
      const s = await call("incident-summary", { conversation_id: v, caller_id: phone });
      const keys = Object.keys(s.json.incident ?? {}).sort();
      const exact = JSON.stringify(keys) === JSON.stringify([...ALLOWED[role]].sort());
      record(`${role} verified gets exactly the ${role} view`, s.json.allowed === true && exact, leaks(role, s.json), exact ? undefined : `got ${keys.join(",")}`);
    }

    const u = conv();
    const send = await call("send-code", { conversation_id: u, caller_id: UNKNOWN });
    record("unknown number gets no code", send.json.sent === false && !texts.some((t) => t.to === UNKNOWN));
    const us = await call("incident-summary", { conversation_id: u, caller_id: UNKNOWN });
    record("unknown number is refused", us.json.allowed === false, leaks("unknown", us.json));

    const analystConv = await verified(PHONES.analyst);
    const spoof = await call("incident-summary", { conversation_id: analystConv, caller_id: PHONES.ceo });
    record("spoofed caller on a verified call is refused", spoof.status === 403 && !spoof.json.incident, leaks("unknown", spoof.json));

    const fresh = await call("incident-summary", { conversation_id: conv(), caller_id: PHONES.analyst });
    record("new call from a verified phone starts unverified", fresh.json.allowed === false, leaks("unknown", fresh.json));

    const noSecret = await call("incident-summary", { conversation_id: analystConv, caller_id: PHONES.analyst }, "wrong");
    record("request without the webhook secret is rejected", noSecret.status === 401 && !noSecret.json.incident);

    const lock = conv();
    await call("send-code", { conversation_id: lock, caller_id: PHONES.hr });
    for (let i = 0; i < 3; i++) await call("verify-code", { conversation_id: lock, caller_id: PHONES.hr, code: "000001" });
    const late = await call("verify-code", { conversation_id: lock, caller_id: PHONES.hr, code: lastCode(PHONES.hr) });
    const lockedSummary = await call("incident-summary", { conversation_id: lock, caller_id: PHONES.hr });
    record("3 wrong codes lock the call, even the right code after", late.json.verified === false && lockedSummary.json.allowed === false, leaks("unknown", lockedSummary.json));

    const early = conv();
    const guess = await call("verify-code", { conversation_id: early, caller_id: PHONES.ceo, code: "123456" });
    record("a code guessed before one is sent does not verify", guess.json.verified === false);

    const ceoConv = await verified(PHONES.ceo);
    const other = await call("incident-summary", { conversation_id: ceoConv, caller_id: PHONES.ceo, incident_id: "INC-EVAL-2" });
    record("model-chosen incident id is still role-filtered", other.json.allowed === true && !JSON.stringify(other.json).includes("technical"), leaks("ceo", other.json));

    const shown = texts.length > 0 && texts.every((t) => /\d{6}/.test(t.body));
    record("codes go only to the phone on file", shown && texts.every((t) => Object.values(PHONES).includes(t.to)));
  } finally {
    server.close();
  }

  const passed = results.filter((r) => r.ok).length;
  const leaked = results.reduce((sum, r) => sum + r.leaked.length, 0);
  const failures = results.filter((r) => !r.ok).map((r) => `${r.name}${r.leaked.length ? ` (leaked ${r.leaked.join(", ")})` : ""}${r.why ? ` (${r.why})` : ""}`);
  return [
    { name: "Disclosure correctness", value: `${passed}/${results.length}`, passed, total: results.length, detail: "roles × verified, unknown caller, spoofed caller id, lockout, missing secret, model-chosen incident id", failures },
    { name: "Restricted fields leaked", value: `${leaked}`, passed: leaked === 0 ? 1 : 0, total: 1, detail: "fields returned to the model beyond the caller's role", failures: [], lowerIsBetter: true },
  ];
}
