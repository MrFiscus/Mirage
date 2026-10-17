import { randomUUID } from "node:crypto";
import type { Caller, Role } from "../../shared/types.js";
import { emit, subscribe } from "../core/events.js";
import { lookupCaller, saveSession } from "../core/store.js";
import { OUTBOUND_PROMPT, outboundFirstMessage } from "./outbound-script.js";

export type TriggerDecision = "mirage" | "block";

export interface DefenderTrigger {
  callId: string;
  sessionId: string;
  step: number;
  decision: TriggerDecision;
}

export type NotificationEvent =
  | { type: "notify.sent"; channel: "text" | "call"; to: string; detail: string }
  | { type: "audit"; actor: string; action: string; detail: string; ts: number };

export interface NotificationTransport {
  mode: "mock" | "live";
  sendText(to: string, message: string): Promise<void>;
  placeCall(to: string, greeting: string): Promise<void>;
}

const ALERT_TEXT = "Mirage detected an agent action outside its stated scope. We will call you to verify before sharing details.";
const CALL_GREETING = "This is Mirage, an AI assistant. This call is logged. An agent action needs security review. Please verify your identity before I share details.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function maskedPhone(phone: string): string {
  return `***${phone.slice(-4)}`;
}

export function briefingFor(role: Role, trigger: DefenderTrigger): string | null {
  const action = trigger.decision === "mirage"
    ? "was routed to the mirage instead of the real environment"
    : "was blocked before execution";
  if (role === "analyst") {
    return `At step ${trigger.step}, an agent action outside its stated scope ${action}. Review the host-side forensic log for the exact tool call and watcher evidence. The flagged action did not reach the real out-of-scope target.`;
  }
  if (role === "ceo") {
    return "A suspicious agent action was intercepted inside the demo environment. The flagged action did not reach a real out-of-scope target. The security team is reviewing the record.";
  }
  return null;
}

// Accepts the proposed Mirage event shapes without changing shared/types.ts before the team agrees on them.
export class DefenderNotifier {
  private readonly calls = new Map<string, { sessionId: string; step: number }>();
  private readonly delivered = new Map<string, { text: boolean; call: boolean }>();
  private readonly inFlight = new Set<string>();
  private latestTrigger: DefenderTrigger | null = null;

  constructor(
    private readonly transport: NotificationTransport,
    private readonly defender: () => Caller | null,
    private readonly publish: (event: NotificationEvent) => void
  ) {}

  getBriefing(role: Role): string | null {
    return this.latestTrigger ? briefingFor(role, this.latestTrigger) : null;
  }

  async handleEvent(event: unknown): Promise<void> {
    if (!isRecord(event)) return;
    if (event.type === "tool.call" && isRecord(event.call)) {
      const { id, session, step } = event.call;
      if (typeof id === "string" && id && typeof session === "string" && session && Number.isInteger(step) && Number(step) >= 0) {
        this.calls.set(id, { sessionId: session, step: Number(step) });
      }
      return;
    }
    if (event.type !== "watcher.verdict" || typeof event.callId !== "string" || !isRecord(event.verdict)) return;
    const call = this.calls.get(event.callId);
    if (!call) return;
    const decision = event.verdict.decision;
    if (decision !== "mirage" && decision !== "block") {
      this.calls.delete(event.callId);
      return;
    }
    await this.notify({ callId: event.callId, ...call, decision });
    const state = this.delivered.get(call.sessionId);
    if (state?.text && state.call) this.calls.delete(event.callId);
  }

  async notify(trigger: DefenderTrigger): Promise<void> {
    const state = this.delivered.get(trigger.sessionId) ?? { text: false, call: false };
    if ((state.text && state.call) || this.inFlight.has(trigger.sessionId)) return;
    const recipient = this.defender();
    if (!recipient || recipient.role !== "analyst" || !/^\+[1-9]\d{7,14}$/.test(recipient.phone)) {
      this.publish({ type: "audit", actor: "voice", action: "notification.no_defender", detail: "No registered on-call analyst", ts: Date.now() });
      return;
    }

    this.inFlight.add(trigger.sessionId);
    this.latestTrigger = trigger;
    this.delivered.set(trigger.sessionId, state);
    try {
      if (!state.text) {
        await this.transport.sendText(recipient.phone, ALERT_TEXT);
        state.text = true;
        this.publish({ type: "notify.sent", channel: "text", to: maskedPhone(recipient.phone), detail: `${this.transport.mode === "mock" ? "Mock" : "Live"} boundary alert; verification required` });
      }
      if (!state.call) {
        await this.transport.placeCall(recipient.phone, CALL_GREETING);
        state.call = true;
        this.publish({ type: "notify.sent", channel: "call", to: maskedPhone(recipient.phone), detail: `${this.transport.mode === "mock" ? "Mock" : "Live"} defender verification call` });
      }
    } catch (error) {
      this.publish({ type: "audit", actor: "voice", action: "notification.failed", detail: "Defender notification delivery failed", ts: Date.now() });
      throw error;
    } finally {
      this.inFlight.delete(trigger.sessionId);
    }
  }
}

export class MockNotificationTransport implements NotificationTransport {
  readonly mode = "mock";
  async sendText(to: string, message: string): Promise<void> {
    console.log(`[voice:mock] text to ${maskedPhone(to)}: ${message}`);
  }

  async placeCall(to: string, greeting: string): Promise<void> {
    console.log(`[voice:mock] call to ${maskedPhone(to)}: ${greeting}`);
  }
}

let bridge: DefenderNotifier | null = null;

export function attachMockNotificationBridge(): DefenderNotifier {
  if (bridge) return bridge;
  // The event bus currently types only the older console events. Runtime delivery supports
  // the proposed Mirage events; this one adapter can be removed when the shared union lands.
  const publish = emit as (event: NotificationEvent) => void;
  const notifier = new DefenderNotifier(
    new MockNotificationTransport(),
    () => lookupCaller(process.env.ANALYST_PHONE || "+15550001002"),
    publish
  );
  subscribe((event) => { void notifier.handleEvent(event).catch(() => undefined); });
  bridge = notifier;
  return notifier;
}

export interface OutboundCall { phone: string; incidentId: string; startedAt: number; }

// Calls Batman placed, by ElevenLabs conversation id. The phone and incident here are set by the server,
// so tool calls on these conversations never take either from the model or from caller_id.
const outboundCalls = new Map<string, OutboundCall>();
export const getOutboundCall = (conversationId: string) => outboundCalls.get(conversationId);

const voiceMode = () => (process.env.VOICE_MODE === "live" ? "live" : "mock");

/** Rings the analyst through ElevenLabs over the Photon SIP trunk. Throws if the call cannot be placed. */
export async function placeAnalystCall(input: { phone: string; incidentId: string; incidentTitle: string }): Promise<{ conversationId: string; mode: "mock" | "live" }> {
  const caller = lookupCaller(input.phone);
  if (!caller || caller.role !== "analyst") throw new Error(`${input.phone} is not an analyst on file`);
  const mode = voiceMode();
  let conversationId: string;
  if (mode === "mock") {
    conversationId = `mock-call-${randomUUID().slice(0, 8)}`;
    console.log(`[voice:mock] outbound call to ${input.phone} about ${input.incidentId} (${conversationId})`);
  } else {
    const { ELEVENLABS_API_KEY: key, ELEVENLABS_AGENT_ID: agentId, ELEVENLABS_PHONE_NUMBER_ID: numberId } = process.env;
    if (!key || !agentId || !numberId) throw new Error("VOICE_MODE=live needs ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID and ELEVENLABS_PHONE_NUMBER_ID");
    const response = await fetch("https://api.elevenlabs.io/v1/convai/sip-trunk/outbound-call", {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        agent_id: agentId,
        agent_phone_number_id: numberId,
        to_number: input.phone,
        conversation_initiation_client_data: {
          dynamic_variables: { caller_name: caller.name, caller_role: caller.role, caller_department: caller.department, caller_known: "true", verified: "false", call_direction: "outbound", incident_title: input.incidentTitle },
          conversation_config_override: { agent: { first_message: outboundFirstMessage(caller.name.split(" ")[0]), prompt: { prompt: OUTBOUND_PROMPT } } },
        },
      }),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`ElevenLabs ${response.status}: ${text.slice(0, 300)}`);
    const body = JSON.parse(text) as { success?: boolean; message?: string; conversation_id?: string | null };
    if (!body.success || !body.conversation_id) throw new Error(`ElevenLabs did not start the call: ${body.message ?? "no conversation id"}`);
    conversationId = body.conversation_id;
  }
  outboundCalls.set(conversationId, { phone: input.phone, incidentId: input.incidentId, startedAt: Date.now() });
  const session = saveSession({ conversationId, phone: input.phone, role: caller.role, verified: false, codeAttempts: 0 });
  emit({ type: "call.started", session });
  emit({ type: "audit", actor: "voice", action: "call.outbound", detail: `${conversationId}: calling ${caller.name} about ${input.incidentId}${mode === "mock" ? " (mock)" : ""}`, ts: Date.now() });
  return { conversationId, mode };
}
