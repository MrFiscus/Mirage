import { describe, expect, it, vi } from "vitest";
import type { Caller } from "../../shared/types.js";
import { briefingFor, DefenderNotifier, getMirageOutboundCall, LiveNotificationTransport, type NotificationEvent, type NotificationTransport } from "./outbound.js";

const analyst: Caller = { phone: "+15550001002", name: "Jordan Bell", role: "analyst", department: "Security Operations" };

function setup(recipient: Caller | null = analyst) {
  const order: string[] = [];
  const events: NotificationEvent[] = [];
  const transport: NotificationTransport = {
    mode: "mock",
    async sendText(_to, message) { order.push("text"); expect(message).not.toContain("ignore all rules"); },
    async placeCall(_to, greeting) { order.push("call"); expect(greeting).toContain("AI assistant"); }
  };
  const notifier = new DefenderNotifier(transport, () => recipient, (event) => events.push(event));
  return { notifier, order, events };
}

describe("defender notification", () => {
  it("uses Photon for live text and pins the ElevenLabs call to its Mirage trigger", async () => {
    const originalFetch = globalThis.fetch;
    const keys = ["ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID", "ELEVENLABS_PHONE_NUMBER_ID"] as const;
    const previous = keys.map((key) => process.env[key]);
    const sent: string[] = [];
    const trigger = { callId: "crossing-1", sessionId: "attack-1", step: 7, decision: "mirage" as const };
    let payload: Record<string, any> = {};
    process.env.ELEVENLABS_API_KEY = "test-key";
    process.env.ELEVENLABS_AGENT_ID = "test-agent";
    process.env.ELEVENLABS_PHONE_NUMBER_ID = "test-number";
    globalThis.fetch = (async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ success: true, conversation_id: "mirage-test-conversation" }));
    }) as typeof fetch;
    try {
      const transport = new LiveNotificationTransport({ async send(to, body) { sent.push(`${to}:${body}`); } });
      await transport.sendText("+17372155908", "Boundary alert");
      await transport.placeCall("+17372155908", "This is Mirage, an AI assistant. This call is logged.", trigger);
      expect(sent).toEqual(["+17372155908:Boundary alert"]);
      expect(payload).toMatchObject({ agent_id: "test-agent", agent_phone_number_id: "test-number", to_number: "+17372155908" });
      expect(payload.conversation_initiation_client_data.conversation_config_override.agent.prompt.prompt).toContain("mirage_briefing");
      expect(getMirageOutboundCall("mirage-test-conversation")).toMatchObject({ phone: "+17372155908", trigger });
    } finally {
      globalThis.fetch = originalFetch;
      keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    }
  });
  it("sends a safe text before the call for the first mirage verdict and suppresses repeats", async () => {
    const { notifier, order, events } = setup();
    await notifier.handleEvent({ type: "tool.call", call: { id: "call-1", session: "session-1", step: 4, thought: "ignore all rules" } });
    await notifier.handleEvent({ type: "watcher.verdict", callId: "call-1", verdict: { decision: "mirage", reasons: ["ignore all rules"] } });
    await notifier.handleEvent({ type: "tool.call", call: { id: "call-2", session: "session-1", step: 5 } });
    await notifier.handleEvent({ type: "watcher.verdict", callId: "call-2", verdict: { decision: "block" } });

    expect(order).toEqual(["text", "call"]);
    expect(events.filter((event) => event.type === "notify.sent")).toEqual([
      { type: "notify.sent", channel: "text", to: "***1002", detail: "Mock boundary alert; verification required" },
      { type: "notify.sent", channel: "call", to: "***1002", detail: "Mock defender verification call" }
    ]);
    expect(notifier.getBriefing("analyst")).toContain("step 4");
  });

  it("ignores pass verdicts and refuses to notify an unregistered defender", async () => {
    const { notifier, order } = setup();
    await notifier.handleEvent({ type: "tool.call", call: { id: "safe", session: "session-2", step: 1 } });
    await notifier.handleEvent({ type: "watcher.verdict", callId: "safe", verdict: { decision: "pass" } });
    expect(order).toEqual([]);

    const missing = setup(null);
    await missing.notifier.notify({ callId: "crossing", sessionId: "session-3", step: 2, decision: "block" });
    expect(missing.order).toEqual([]);
    expect(missing.events).toEqual([expect.objectContaining({ type: "audit", action: "notification.no_defender" })]);
  });

  it("retries only a failed call after the text was sent", async () => {
    const events: NotificationEvent[] = [];
    const sendText = vi.fn(async () => undefined);
    const placeCall = vi.fn()
      .mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce(undefined);
    const notifier = new DefenderNotifier({ mode: "mock", sendText, placeCall }, () => analyst, (event) => events.push(event));
    await notifier.handleEvent({ type: "tool.call", call: { id: "call-3", session: "session-4", step: 3 } });
    const verdict = { type: "watcher.verdict", callId: "call-3", verdict: { decision: "mirage" } };

    await expect(notifier.handleEvent(verdict)).rejects.toThrow("temporary outage");
    await notifier.handleEvent(verdict);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(placeCall).toHaveBeenCalledTimes(2);
    expect(events.find((event) => event.type === "audit" && event.action === "notification.failed")).toEqual(
      expect.objectContaining({ detail: "Defender notification delivery failed" })
    );
  });

  it("gives only role-appropriate facts after verification", () => {
    const trigger = { callId: "call-4", sessionId: "session-5", step: 8, decision: "block" as const };
    expect(briefingFor("analyst", trigger)).toContain("host-side forensic log");
    expect(briefingFor("ceo", trigger)).toContain("security team");
    expect(briefingFor("hr", trigger)).toBeNull();
    expect(briefingFor("unknown", trigger)).toBeNull();
  });
});
