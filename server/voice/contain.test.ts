import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it, vi } from "vitest";
import { getSession, saveSession } from "../core/store.js";
import { LiveNotificationTransport } from "./outbound.js";
import { voiceRouter } from "./routes.js";
import { VerificationService } from "./verification.js";

describe("Mirage containment tool", () => {
  it("requires a verified analyst on a pinned outbound call and records the cage result honestly", async () => {
    const envNames = ["VOICE_WEBHOOK_SECRET", "ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID", "ELEVENLABS_PHONE_NUMBER_ID", "PORT"] as const;
    const previous = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
    process.env.VOICE_WEBHOOK_SECRET = "test-voice-secret";
    process.env.ELEVENLABS_API_KEY = "test-eleven-key";
    process.env.ELEVENLABS_AGENT_ID = "test-agent";
    process.env.ELEVENLABS_PHONE_NUMBER_ID = "test-number";
    process.env.PORT = "8787";

    const conversationId = `contain-${randomUUID()}`;
    const sessionId = `session-${randomUUID()}`;
    const phone = "+15550001002";
    let code = "";
    let cageStatus = 200;
    const cageCalls: string[] = [];
    const originalFetch = globalThis.fetch;
    const backendFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("api.elevenlabs.io")) return new Response(JSON.stringify({ success: true, conversation_id: conversationId }), { status: 200 });
      cageCalls.push(url);
      return new Response(JSON.stringify(cageStatus === 200 ? { contained: true, network: "requested" } : { error: "not running" }), { status: cageStatus });
    });

    let server: ReturnType<express.Express["listen"]> | undefined;
    try {
      const transport = new LiveNotificationTransport({ async send() {} });
      await transport.placeCall(phone, "This is Mirage", {
        callId: "call-1", sessionId, step: 4, decision: "mirage", priority: "high"
      });

      const verification = new VerificationService({
        async send(_to, message) { code = /\b\d{6}\b/.exec(message)?.[0] ?? ""; }
      });
      const app = express();
      app.use(voiceRouter(verification, { getBriefing: () => "Verified Mirage briefing" }));
      server = app.listen(0, "127.0.0.1");
      await new Promise<void>((resolve) => server!.once("listening", resolve));
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const body = { caller_id: "+15550009999", conversation_id: conversationId };
      const post = async (path: string, payload: object) => {
        const response = await originalFetch(`${base}${path}`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-batman-secret": "test-voice-secret" },
          body: JSON.stringify(payload)
        });
        return response.json() as Promise<Record<string, unknown>>;
      };

      expect(await post("/voice/tools/contain", { ...body, decision: "contain" })).toMatchObject({ done: false });
      expect(cageCalls).toHaveLength(0);
      expect(await post("/voice/tools/send-code", body)).toMatchObject({ sent: true });
      expect(code).toMatch(/^\d{6}$/);
      expect(await post("/voice/tools/verify-code", { ...body, code })).toMatchObject({ verified: true });

      expect(await post("/voice/tools/contain", { ...body, decision: "hold" })).toMatchObject({ done: true, decision: "hold" });
      expect(cageCalls).toHaveLength(0);
      expect(await post("/voice/tools/contain", { ...body, decision: "contain", session_id: "model-chosen-session" }))
        .toMatchObject({ done: true, decision: "contain", stopRequested: true });
      expect(cageCalls).toEqual([`http://127.0.0.1:8787/cage/sessions/${sessionId}/contain`]);

      cageStatus = 404;
      expect(await post("/voice/tools/contain", { ...body, decision: "contain" }))
        .toMatchObject({ done: true, stopRequested: false, message: expect.stringContaining("authorization was recorded") });

      const inbound = `inbound-${randomUUID()}`;
      saveSession({ conversationId: inbound, phone, role: "analyst", verified: true, codeAttempts: 0 });
      expect(await post("/voice/tools/contain", { caller_id: phone, conversation_id: inbound, decision: "contain" }))
        .toMatchObject({ done: false, message: expect.stringContaining("outbound Mirage") });

      const pinnedSession = getSession(conversationId)!;
      saveSession({ ...pinnedSession, role: "ceo" });
      expect(await post("/voice/tools/contain", { ...body, decision: "contain" }))
        .toMatchObject({ done: false, message: expect.stringContaining("Only a security analyst") });
      expect(cageCalls).toHaveLength(2);
    } finally {
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
      backendFetch.mockRestore();
      for (const name of envNames) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
    }
  });
});
