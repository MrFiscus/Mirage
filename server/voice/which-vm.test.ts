import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import { getSession, saveSession } from "../core/store.js";
import { LiveNotificationTransport } from "./outbound.js";
import { voiceRouter } from "./routes.js";
import { VerificationService } from "./verification.js";

describe("which VM voice tool", () => {
  it("answers only a verified analyst with the machine pinned to that conversation", async () => {
    const previousSecret = process.env.VOICE_WEBHOOK_SECRET;
    const previousApi = process.env.ELEVENLABS_API_KEY;
    const previousAgent = process.env.ELEVENLABS_AGENT_ID;
    const previousNumber = process.env.ELEVENLABS_PHONE_NUMBER_ID;
    process.env.VOICE_WEBHOOK_SECRET = "test-voice-secret";
    process.env.ELEVENLABS_API_KEY = "test-eleven-key";
    process.env.ELEVENLABS_AGENT_ID = "test-agent";
    process.env.ELEVENLABS_PHONE_NUMBER_ID = "test-number";

    const conversations = [`vm-one-${randomUUID()}`, `vm-two-${randomUUID()}`];
    const phone = "+15550001002";
    let callIndex = 0;
    let code = "";
    const originalFetch = globalThis.fetch;
    const apiFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ success: true, conversation_id: conversations[callIndex++] }), { status: 200 }));
    let server: ReturnType<express.Express["listen"]> | undefined;
    try {
      const transport = new LiveNotificationTransport({ async send() {} });
      await transport.placeCall(phone, "Mirage alert", {
        callId: "call-one", sessionId: "session-one", step: 3, decision: "block", priority: "high", machineLabel: "ava.PC@coffee.org"
      });
      await transport.placeCall(phone, "Mirage alert", {
        callId: "call-two", sessionId: "session-two", step: 4, decision: "block", priority: "high", machineLabel: "liam.PC@coffee.org"
      });

      const verification = new VerificationService({
        async send(_to, message) { code = /\b\d{6}\b/.exec(message)?.[0] ?? ""; }
      });
      const app = express();
      app.use(voiceRouter(verification, { getBriefing: () => null }));
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server!.once("listening", resolve));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const post = async (path: string, payload: object, secret = "test-voice-secret") => {
        const response = await originalFetch(`${base}${path}`, {
          method: "POST", headers: { "content-type": "application/json", "x-batman-secret": secret }, body: JSON.stringify(payload)
        });
        return { status: response.status, body: await response.json() as Record<string, unknown> };
      };
      const first = { conversation_id: conversations[0], caller_id: "+15550009999" };
      const second = { conversation_id: conversations[1], caller_id: "+15550009999" };

      expect((await post("/voice/tools/which-vm", first, "wrong-secret")).status).toBe(401);
      expect((await post("/voice/tools/which-vm", first)).body).toMatchObject({ allowed: false });
      expect((await post("/voice/tools/send-code", first)).body).toMatchObject({ sent: true });
      expect((await post("/voice/tools/verify-code", { ...first, code })).body).toMatchObject({ verified: true });
      expect((await post("/voice/tools/which-vm", { ...first, session_id: "session-two", machine: "wrong" })).body)
        .toMatchObject({ allowed: true, machine: "ava.PC@coffee.org" });
      expect((await post("/voice/tools/which-vm", second)).body).toMatchObject({ allowed: false });

      expect((await post("/voice/tools/send-code", second)).body).toMatchObject({ sent: true });
      expect((await post("/voice/tools/verify-code", { ...second, code })).body).toMatchObject({ verified: true });
      expect((await post("/voice/tools/which-vm", second)).body)
        .toMatchObject({ allowed: true, machine: "liam.PC@coffee.org" });

      const firstSession = getSession(conversations[0])!;
      saveSession({ ...firstSession, role: "ceo" });
      expect((await post("/voice/tools/which-vm", first)).body).toMatchObject({ allowed: false });
      const inboundId = `inbound-${randomUUID()}`;
      saveSession({ conversationId: inboundId, phone, role: "analyst", verified: true, codeAttempts: 0 });
      expect((await post("/voice/tools/which-vm", { caller_id: phone, conversation_id: inboundId })).body)
        .toMatchObject({ allowed: false });
    } finally {
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
      apiFetch.mockRestore();
      for (const [name, value] of Object.entries({
        VOICE_WEBHOOK_SECRET: previousSecret, ELEVENLABS_API_KEY: previousApi,
        ELEVENLABS_AGENT_ID: previousAgent, ELEVENLABS_PHONE_NUMBER_ID: previousNumber
      })) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    }
  });
});
