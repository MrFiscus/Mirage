import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import type { Caller, RunSummary } from "../../shared/types.js";
import { DefenderNotifier, type NotificationEvent } from "./outbound.js";
import { getProvenance, sign, signTrigger, verify } from "./provenance.js";
import { voiceRouter } from "./routes.js";
import { VerificationService } from "./verification.js";

describe("signed Mirage run reference", () => {
  it("signs the first trigger, puts its short reference in the alert, and keeps it stable at summary", async () => {
    const previous = process.env.PROVENANCE_SECRET;
    process.env.PROVENANCE_SECRET = "test-provenance-key";
    const session = `run-${randomUUID()}`;
    const messages: string[] = [];
    const events: NotificationEvent[] = [];
    const analyst: Caller = { phone: "+15550001002", name: "Jordan Bell", role: "analyst", department: "SOC" };
    const notifier = new DefenderNotifier({
      mode: "mock",
      async sendText(_to, message) { messages.push(message); },
      async placeCall() {}
    }, () => analyst, (event) => events.push(event));
    try {
      await notifier.handleEvent({ type: "session.started", session: { id: session, attacker: "scripted" } });
      await notifier.handleEvent({ type: "tool.call", call: { id: "crossing", session, step: 3 } });
      await notifier.handleEvent({ type: "watcher.verdict", callId: "crossing", verdict: { decision: "mirage", score: 0.7, reasons: ["out-of-scope path"] } });
      const first = getProvenance(session)!;
      expect(first).toBeDefined();
      expect(verify(first)).toBe(true);
      expect(messages[0]).toContain(`Ref: ${first.fingerprint.slice(0, 8)}`);
      expect(messages[0]).not.toContain("out-of-scope path");

      const summary: RunSummary = {
        session, attacker: "scripted", honestEnv: "acme", triggered: true,
        triggerStep: 3, triggerReason: "out-of-scope path", realCalls: 2, fakeCalls: 1,
        blocked: 0, loopDepth: 1, realOutOfScope: 0, watcherMisses: 0, watcherOn: true,
        networkIsolation: "n/a", durationMs: 100, ts: Date.now()
      };
      await notifier.handleEvent({ type: "run.summary", summary });
      expect(getProvenance(session)?.fingerprint).toBe(first.fingerprint);
      expect(events).toContainEqual(expect.objectContaining({ type: "audit", action: "provenance.signed", detail: expect.stringContaining(first.fingerprint) }));
      expect(verify({ ...first, record: { ...first.record, triggerStep: 8 } })).toBe(false);
      expect(verify({ ...first, sig: "00".repeat(32) })).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.PROVENANCE_SECRET;
      else process.env.PROVENANCE_SECRET = previous;
    }
  });

  it("does not sign with an absent key", () => {
    const provenance = process.env.PROVENANCE_SECRET;
    const voice = process.env.VOICE_WEBHOOK_SECRET;
    delete process.env.PROVENANCE_SECRET;
    delete process.env.VOICE_WEBHOOK_SECRET;
    try {
      expect(() => sign({ session: "missing", attacker: "scripted", triggerStep: 1, triggerReason: "test", ts: 1 })).toThrow(/required/);
    } finally {
      if (provenance === undefined) delete process.env.PROVENANCE_SECRET;
      else process.env.PROVENANCE_SECRET = provenance;
      if (voice === undefined) delete process.env.VOICE_WEBHOOK_SECRET;
      else process.env.VOICE_WEBHOOK_SECRET = voice;
    }
  });

  it("serves a signed record only with the webhook secret", async () => {
    const priorVoice = process.env.VOICE_WEBHOOK_SECRET;
    const priorProvenance = process.env.PROVENANCE_SECRET;
    process.env.VOICE_WEBHOOK_SECRET = "test-webhook-secret";
    process.env.PROVENANCE_SECRET = "test-provenance-key";
    const session = `record-${randomUUID()}`;
    signTrigger({ session, attacker: "scripted", triggerStep: 2, triggerReason: "outside scope", ts: Date.now() });
    const app = express();
    app.use(voiceRouter(new VerificationService({ async send() {} }), { getBriefing: () => null }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/voice/provenance/${session}`;
    try {
      expect((await fetch(url)).status).toBe(401);
      const response = await fetch(url, { headers: { "x-batman-secret": "test-webhook-secret" } });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ record: { session }, verified: true });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (priorVoice === undefined) delete process.env.VOICE_WEBHOOK_SECRET;
      else process.env.VOICE_WEBHOOK_SECRET = priorVoice;
      if (priorProvenance === undefined) delete process.env.PROVENANCE_SECRET;
      else process.env.PROVENANCE_SECRET = priorProvenance;
    }
  });
});
