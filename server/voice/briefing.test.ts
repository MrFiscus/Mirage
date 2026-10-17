import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { describe, expect, it } from "vitest";
import { voiceRouter } from "./routes.js";
import { VerificationService } from "./verification.js";

describe("Mirage briefing tool", () => {
  it("withholds the briefing until the server verifies the caller's code", async () => {
    const previousSecret = process.env.VOICE_WEBHOOK_SECRET;
    process.env.VOICE_WEBHOOK_SECRET = "test-voice-secret";
    let code = "";
    const verification = new VerificationService({
      async send(_to, message) { code = /\b\d{6}\b/.exec(message)?.[0] ?? ""; }
    });
    const app = express();
    app.use(voiceRouter(verification, { getBriefing: (role) => role === "analyst" ? "Analyst-only forensic briefing" : null }));
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const body = { caller_id: "+15550001002", conversation_id: `briefing-${randomUUID()}` };
    const post = async (path: string, payload: object) => {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-batman-secret": "test-voice-secret" },
        body: JSON.stringify(payload)
      });
      return response.json() as Promise<Record<string, unknown>>;
    };

    try {
      expect(await post("/voice/tools/mirage-briefing", body)).toMatchObject({ allowed: false });
      expect(await post("/voice/tools/send-code", body)).toMatchObject({ sent: true });
      expect(code).toMatch(/^\d{6}$/);
      expect(await post("/voice/tools/verify-code", { ...body, code })).toMatchObject({ verified: true });
      expect(await post("/voice/tools/mirage-briefing", body)).toMatchObject({
        allowed: true, role: "analyst", briefing: "Analyst-only forensic briefing"
      });
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (previousSecret === undefined) delete process.env.VOICE_WEBHOOK_SECRET;
      else process.env.VOICE_WEBHOOK_SECRET = previousSecret;
    }
  });
});
