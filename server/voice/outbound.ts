import { randomUUID } from "node:crypto";
import { emit } from "../core/events.js";
import { lookupCaller, saveSession } from "../core/store.js";
import { OUTBOUND_PROMPT, outboundFirstMessage } from "./outbound-script.js";

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
