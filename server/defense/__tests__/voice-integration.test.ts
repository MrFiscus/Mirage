// Defense engine (Person 2) -> real store -> voice tools (Person 1). No mocks of either lane's logic;
// only the text sender is replaced so the test can read the verification code.
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { approve } from "../approval.js";
import { getIncident } from "../core.js";
import { cleanup, startScenario } from "../orchestrator.js";
import { voiceRouter } from "../../voice/routes.js";
import { VerificationService } from "../../voice/verification.js";

const CEO = "+15550001001", ANALYST = "+15550001002", UNKNOWN = "+15559998888";
process.env.VOICE_WEBHOOK_SECRET = "test-secret";

const texts: { to: string; body: string }[] = [];
const sender = { async send(to: string, body: string) { texts.push({ to, body }); } };
const lastCode = (to: string) => /(\d{6})/.exec([...texts].reverse().find((t) => t.to === to)!.body)![1];

let server: Server, base = "";
beforeAll(async () => {
  const app = express();
  app.use(voiceRouter(new VerificationService(sender)));
  await new Promise<void>((resolve) => { server = app.listen(0, () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => { server.close(); });

let n = 0;
async function call(tool: string, body: Record<string, unknown>) {
  const res = await fetch(`${base}/voice/tools/${tool}`, { method: "POST", headers: { "content-type": "application/json", "x-batman-secret": "test-secret" }, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json()) as any };
}
/** A verified call: text the code, read it back, return the conversation id. */
async function verifiedCall(phone: string) {
  const conversation_id = `conv-${++n}`;
  expect((await call("send-code", { conversation_id, caller_id: phone })).json.sent).toBe(true);
  expect((await call("verify-code", { conversation_id, caller_id: phone, code: lastCode(phone) })).json.verified).toBe(true);
  return conversation_id;
}
const summary = (conversation_id: string, caller_id: string, incident_id: string) => call("incident-summary", { conversation_id, caller_id, incident_id });

describe("voice reads a real defense incident", () => {
  it("scenario 1: CEO gets business view, analyst gets technical view, nobody gets more than their role", async () => {
    const inc = await startScenario("1");
    try {
      const stored = getIncident(inc.id)!;
      expect(stored.status).toBe("awaiting_approval");

      const ceoConv = await verifiedCall(CEO);
      const ceo = (await summary(ceoConv, CEO, inc.id)).json;
      expect(ceo.allowed).toBe(true);
      expect(ceo.incident.businessSummary).toBe(stored.businessSummary);
      expect(ceo.incident.fixState).toMatch(/waiting for analyst approval/);
      for (const restricted of ["technicalSummary", "evidence", "proposedFix", "confidence"]) expect(ceo.incident).not.toHaveProperty(restricted);
      expect(JSON.stringify(ceo)).not.toContain("rogue-miner");   // no raw evidence leaks into the CEO's payload

      const anaConv = await verifiedCall(ANALYST);
      const ana = (await summary(anaConv, ANALYST, inc.id)).json;
      expect(ana.incident.technicalSummary).toBe(stored.technicalSummary);
      expect(ana.incident.evidence).toEqual(stored.evidence);
      expect(ana.incident.evidence.length).toBeGreaterThan(0);
      expect(ana.incident.proposedFix.cloneCheck.passed).toBe(true);
      expect(ana.incident).not.toHaveProperty("businessSummary");

      // After the analyst approves, the next call sees the resolved state.
      await approve(inc.id, ANALYST);
      expect((await summary(ceoConv, CEO, inc.id)).json.incident.fixState).toMatch(/applied and verified clean/);
    } finally { await cleanup(inc.id); }
  }, 60_000);

  it("scenario 2: both roles are told the harmful fix was rejected", async () => {
    const inc = await startScenario("2");
    try {
      const ceo = (await summary(await verifiedCall(CEO), CEO, inc.id)).json;
      expect(ceo.incident.status).toBe("fix_rejected");
      expect(ceo.incident.fixState).toMatch(/rejected.*clone's health checks/);
      const ana = (await summary(await verifiedCall(ANALYST), ANALYST, inc.id)).json;
      expect(ana.incident.proposedFix.cloneCheck.passed).toBe(false);
    } finally { await cleanup(inc.id); }
  }, 60_000);

  it("refuses unverified callers, unknown numbers, wrong codes and hijacked conversations", async () => {
    const inc = await startScenario("3");
    try {
      // Known number but never verified.
      const unverified = (await summary("conv-unverified", CEO, inc.id)).json;
      expect(unverified.allowed).toBe(false);
      expect(JSON.stringify(unverified)).not.toContain(getIncident(inc.id)!.businessSummary);

      // Unknown number cannot even get a code.
      const unknown = (await call("send-code", { conversation_id: "conv-unknown", caller_id: UNKNOWN })).json;
      expect(unknown.sent).toBe(false);
      expect(texts.some((t) => t.to === UNKNOWN)).toBe(false);
      expect((await summary("conv-unknown", UNKNOWN, inc.id)).json.allowed).toBe(false);

      // Three wrong codes lock the call, and the right code no longer works.
      const conv = "conv-locked";
      await call("send-code", { conversation_id: conv, caller_id: ANALYST });
      const right = lastCode(ANALYST);
      const wrong = right === "000000" ? "111111" : "000000";
      for (let i = 0; i < 3; i++) await call("verify-code", { conversation_id: conv, caller_id: ANALYST, code: wrong });
      expect((await call("verify-code", { conversation_id: conv, caller_id: ANALYST, code: right })).json.verified).toBe(false);
      expect((await summary(conv, ANALYST, inc.id)).json.allowed).toBe(false);

      // A verified conversation cannot be reused by a different number.
      const ceoConv = await verifiedCall(CEO);
      expect((await summary(ceoConv, ANALYST, inc.id)).status).toBe(403);

      // The role comes from the number on file; a model-supplied role field is ignored.
      const sneaky = await call("incident-summary", { conversation_id: ceoConv, caller_id: CEO, incident_id: inc.id, role: "analyst" });
      expect(sneaky.json.incident).not.toHaveProperty("technicalSummary");
    } finally { await cleanup(inc.id); }
  }, 60_000);

  it("without an incident id, voice picks the most recent open defense incident", async () => {
    const inc = await startScenario("1");
    try {
      const conv = await verifiedCall(ANALYST);
      const res = (await call("incident-summary", { conversation_id: conv, caller_id: ANALYST })).json;
      expect(res.incident.id).toBe(inc.id);
    } finally { await cleanup(inc.id); }
  }, 60_000);
});
