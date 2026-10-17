// How Batman tells the on-call analyst: urgent alerts get a phone call, everything else a text.
import { placeAnalystCall } from "../voice/outbound.js";
import { analystPhone } from "./apply.js";
import { briefingFor, briefingText } from "./briefing.js";
import type { Incident } from "./contracts.js";
import { sendSms } from "./core.js";
import { audit, traceStep } from "./run.js";

/** Phone calls are reserved for high-severity incidents; lower tiers get a text. */
export const isUrgent = (incident: Incident) => incident.severity === "high";

export async function notifyAnalyst(incident: Incident): Promise<"call" | "text"> {
  const to = analystPhone();
  const briefing = briefingFor(incident);
  const step = (who: string, text: string, query: string, result: string[]) => {
    traceStep(incident.id, "agent", { who, text, query, result });
    audit("agent.step", text);
  };

  if (isUrgent(incident)) {
    try {
      const { conversationId, mode } = await placeAnalystCall({ phone: to, incidentId: incident.id, incidentTitle: incident.title });
      const state = incident.status === "fix_rejected" ? " The proposed fix was rejected; nothing was changed." : incident.status === "awaiting_approval" ? " A fix is waiting for your decision." : "";
      const heads = `Batman is calling you now about an urgent alert: ${incident.title}.${state} Ticket ${incident.id}.`;
      sendSms(to, heads);
      step("elevenlabs", "Calling the on-call analyst to explain the alert and ask for a decision",
        `POST ElevenLabs outbound call via Photon SIP to ${to}${mode === "mock" ? "   (demo mode: not dialled)" : ""}`, [`conversation ${conversationId}`, ...briefing.suggestedSteps]);
      return "call";
    } catch (e) {
      audit("call.failed", (e as Error).message.slice(0, 200), "voice");
    }
  }
  const textBriefing = incident.status === "awaiting_approval"
    ? { ...briefing, suggestedSteps: [`Review ticket ${incident.id} in the Batman console to approve or reject the proposed fix. No live fix has been applied.`] }
    : briefing;
  const body = `Ticket ${incident.id}\n${briefingText(textBriefing)}`;
  sendSms(to, body);
  step("photon", isUrgent(incident) ? "Couldn't reach the analyst by phone, so texted the full summary instead" : "Texted the on-call analyst a summary of what happened and what Batman did",
    `POST Photon message to ${to}${process.env.PHOTON_MODE === "live" ? "" : "   (demo mode: logged, not sent)"}`, [body]);
  return "text";
}
