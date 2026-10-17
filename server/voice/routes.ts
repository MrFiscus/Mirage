import { createHmac, timingSafeEqual } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import type { CallSession } from "../../shared/types.js";
import { emit } from "../core/events.js";
import { getIncident, getSession, listIncidents, lookupCaller, saveSession } from "../core/store.js";
import { approve, reject } from "../defense/approval.js";
import { incidentViewFor } from "./disclosure.js";
import { attachNotificationBridge, getMirageOutboundCall, getOutboundCall, type DefenderNotifier } from "./outbound.js";
import { MAX_CODE_ATTEMPTS, type VerificationService } from "./verification.js";

const MAX_CODE_SENDS = 3;
const POST_CALL_TOLERANCE_SECONDS = 30 * 60;
const codeSends = new Map<string, number>();

export function normalizePhone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/^sips?:/, "").split("@")[0].replace(/[^\d+]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;
  return null;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

// ElevenLabs sends this header on the initiation webhook and every server tool.
function requireVoiceSecret(request: Request, response: Response, next: NextFunction): void {
  const secret = process.env.VOICE_WEBHOOK_SECRET;
  if (!secret) {
    response.status(503).json({ error: "VOICE_WEBHOOK_SECRET is not configured" });
    return;
  }
  const provided = request.header("x-batman-secret") ?? "";
  if (!safeEqual(provided, secret)) {
    emit({ type: "audit", actor: "voice", action: "voice.webhook_rejected", detail: request.path, ts: Date.now() });
    response.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

// conversation_id and caller_id must be wired to ElevenLabs system dynamic
// variables in the tool config, never left for the LLM to fill.
function resolveSession(body: Record<string, unknown>): CallSession | { error: string; status: number } {
  const conversationId = typeof body.conversation_id === "string" ? body.conversation_id.trim() : "";
  // On a call Batman placed, caller_id can be the Photon line itself; the number Batman dialled is the one on record.
  const outbound = conversationId ? getOutboundCall(conversationId) ?? getMirageOutboundCall(conversationId) : undefined;
  if (outbound) {
    const session = getSession(conversationId);
    if (session) return session;
  }
  const phone = outbound?.phone ?? normalizePhone(body.caller_id);
  if (!conversationId || !phone) return { error: "conversation_id and caller_id are required", status: 400 };
  const existing = getSession(conversationId);
  if (existing) {
    if (existing.phone !== phone) return { error: "Caller does not match this conversation", status: 403 };
    return existing;
  }
  const caller = lookupCaller(phone);
  const session = saveSession({ conversationId, phone, role: caller?.role ?? "unknown", verified: false, codeAttempts: 0 });
  emit({ type: "call.started", session });
  emit({ type: "audit", actor: "voice", action: "call.started", detail: `${conversationId} as ${session.role}`, ts: Date.now() });
  return session;
}

export function voiceRouter(
  verification: VerificationService,
  notifications: Pick<DefenderNotifier, "getBriefing"> = attachNotificationBridge()
): express.Router {
  const router = express.Router();

  router.post("/voice/init", express.json(), requireVoiceSecret, (request, response) => {
    const phone = normalizePhone(request.body?.caller_id);
    const conversationId = typeof request.body?.conversation_id === "string" ? request.body.conversation_id.trim() : "";
    let session: CallSession | null = null;
    if (phone && conversationId) {
      const resolved = resolveSession(request.body);
      if ("error" in resolved) return response.status(resolved.status).json({ error: resolved.error });
      session = resolved;
    }
    const caller = phone ? lookupCaller(phone) : null;
    const callerDetail = phone ? `caller ending ${phone.slice(-4)}` : "caller ID missing or invalid";
    emit({ type: "audit", actor: "voice", action: "call.ringing", detail: `${callerDetail}; ${caller ? `known ${caller.role}` : "unknown caller"}`, ts: Date.now() });
    // Role here only sets the agent's tone. Access is decided per tool call from the stored session.
    response.json({
      type: "conversation_initiation_client_data",
      dynamic_variables: {
        caller_name: caller?.name ?? "there",
        caller_role: session?.role ?? caller?.role ?? "unknown",
        caller_department: caller?.department ?? "unknown",
        caller_known: caller ? "true" : "false",
        verified: "false"
      }
    });
  });

  router.post("/voice/tools/send-code", express.json(), requireVoiceSecret, async (request, response) => {
    const session = resolveSession(request.body ?? {});
    if ("error" in session) return response.status(session.status).json({ sent: false, message: session.error });
    if (session.verified) return response.json({ sent: false, message: "Caller is already verified." });
    if (session.role === "unknown") {
      emit({ type: "audit", actor: "voice", action: "verification.refused", detail: `${session.conversationId} unknown number`, ts: Date.now() });
      return response.json({ sent: false, message: "This number is not on file, so no code can be sent. Do not share any incident details." });
    }
    if (session.codeAttempts >= MAX_CODE_ATTEMPTS) return response.json({ sent: false, message: "Verification is locked for this call." });
    const sends = codeSends.get(session.conversationId) ?? 0;
    if (sends >= MAX_CODE_SENDS) return response.json({ sent: false, message: "Code send limit reached for this call." });
    codeSends.set(session.conversationId, sends + 1);
    try {
      await verification.request(session.phone);
    } catch (error) {
      emit({ type: "audit", actor: "voice", action: "verification.sms_failed", detail: String(error).slice(0, 200), ts: Date.now() });
      return response.json({ sent: false, message: "The text could not be sent right now. Do not share any incident details." });
    }
    return response.json({ sent: true, message: "A six digit code was texted to the number on file. Ask the caller to read it back." });
  });

  router.post("/voice/tools/verify-code", express.json(), requireVoiceSecret, (request, response) => {
    const session = resolveSession(request.body ?? {});
    if ("error" in session) return response.status(session.status).json({ verified: false, message: session.error });
    if (session.verified) return response.json({ verified: true, message: "Caller is already verified." });
    if (session.codeAttempts >= MAX_CODE_ATTEMPTS) return response.json({ verified: false, message: "Verification is locked for this call." });
    const code = String(request.body?.code ?? "").replace(/\D/g, "");
    const result = /^\d{6}$/.test(code) ? verification.verify(session.phone, code) : "mismatch";
    if (result === "no_code" || result === "expired") {
      return response.json({ verified: false, message: result === "expired" ? "The code expired. Offer to send a new one." : "No code has been sent yet. Send one first." });
    }
    const updated = saveSession({ ...session, codeAttempts: session.codeAttempts + 1, verified: result === "matched" });
    if (updated.verified) {
      emit({ type: "call.started", session: updated });
      emit({ type: "audit", actor: "voice", action: "call.verified", detail: `${updated.conversationId} as ${updated.role}`, ts: Date.now() });
      return response.json({ verified: true, message: "Caller verified." });
    }
    const remaining = MAX_CODE_ATTEMPTS - updated.codeAttempts;
    if (remaining <= 0 || result === "locked") {
      saveSession({ ...updated, codeAttempts: MAX_CODE_ATTEMPTS });
      emit({ type: "audit", actor: "voice", action: "call.verification_locked", detail: updated.conversationId, ts: Date.now() });
      return response.json({ verified: false, message: "Too many wrong codes. Verification is locked for this call. Do not share any incident details." });
    }
    return response.json({ verified: false, message: `That code did not match. ${remaining} attempt${remaining === 1 ? "" : "s"} left.` });
  });

  router.post("/voice/tools/incident-summary", express.json(), requireVoiceSecret, (request, response) => {
    const session = resolveSession(request.body ?? {});
    if ("error" in session) return response.status(session.status).json({ allowed: false, message: session.error });
    const pinned = getOutboundCall(session.conversationId)?.incidentId;
    const requestedId = typeof request.body?.incident_id === "string" ? request.body.incident_id : "";
    const incidents = listIncidents();
    const incident = pinned ? getIncident(pinned) : (requestedId && getIncident(requestedId)) || incidents.find((item) => !["resolved", "fix_rejected"].includes(item.status)) || incidents[0];
    if (!session.verified) {
      emit({ type: "disclosure", conversationId: session.conversationId, role: session.role, fields: [], allowed: false });
      return response.json({ allowed: false, message: "The caller is not verified. Share no incident details. Offer to text a verification code." });
    }
    if (!incident) return response.json({ allowed: true, message: "There are no open incidents on record." });
    const view = incidentViewFor(session.role, incident);
    if (!view) {
      emit({ type: "disclosure", conversationId: session.conversationId, role: session.role, fields: [], allowed: false });
      return response.json({ allowed: false, message: "This caller's role has no access to incident details." });
    }
    emit({ type: "disclosure", conversationId: session.conversationId, role: session.role, fields: Object.keys(view), allowed: true });
    return response.json({ allowed: true, role: session.role, incident: view });
  });

  router.post("/voice/tools/mirage-briefing", express.json(), requireVoiceSecret, (request, response) => {
    const session = resolveSession(request.body ?? {});
    if ("error" in session) return response.status(session.status).json({ allowed: false, message: session.error });
    if (!session.verified) {
      emit({ type: "disclosure", conversationId: session.conversationId, role: session.role, fields: [], allowed: false });
      return response.json({ allowed: false, message: "Verify the caller before sharing the Mirage alert." });
    }
    const briefing = notifications.getBriefing(session.role, session.conversationId);
    if (!briefing) {
      emit({ type: "disclosure", conversationId: session.conversationId, role: session.role, fields: [], allowed: false });
      return response.json({ allowed: false, message: "No alert is available to this caller." });
    }
    emit({ type: "disclosure", conversationId: session.conversationId, role: session.role, fields: ["mirage_briefing"], allowed: true });
    return response.json({ allowed: true, role: session.role, briefing });
  });

  // Analyst approves or rejects the pending fix out loud. Only on a call Batman placed about that incident,
  // only once verified, and the approver is the session's phone, never a tool argument.
  router.post("/voice/tools/decide-fix", express.json(), requireVoiceSecret, async (request, response) => {
    const session = resolveSession(request.body ?? {});
    if ("error" in session) return response.status(session.status).json({ done: false, message: session.error });
    const decision = request.body?.decision;
    const incidentId = getOutboundCall(session.conversationId)?.incidentId;
    const refuse = (message: string) => {
      emit({ type: "audit", actor: "voice", action: "decision.refused", detail: `${session.conversationId}: ${message}`, ts: Date.now() });
      return response.json({ done: false, message });
    };
    if (!session.verified) return refuse("The caller is not verified. Do not take a decision.");
    if (session.role !== "analyst") return refuse("Only a security analyst can approve or reject a fix.");
    if (!incidentId) return refuse("This call is not about a pending fix.");
    if (decision !== "approve" && decision !== "reject") return refuse("Decision must be approve or reject. Ask the analyst again.");
    try {
      if (decision === "approve") await approve(incidentId, session.phone);
      else await reject(incidentId, session.phone);
    } catch (error) {
      return refuse(`That could not be done: ${(error as Error).message}.`);
    }
    emit({ type: "audit", actor: "voice", action: `decision.${decision}`, detail: `${session.conversationId} on ${incidentId}`, ts: Date.now() });
    const status = getIncident(incidentId)?.status;
    const message = status === "resolved" ? "Done. The fix was applied and the machine re-checked clean."
      : status === "fix_rejected" && decision === "reject" ? "Okay. Nothing was changed, and the ticket is closed as not fixed."
      : `The ticket is now ${status?.replace(/_/g, " ") ?? "unknown"}. Details are in the console.`;
    return response.json({ done: true, status, message });
  });

  // Post-call webhook: HMAC signed by ElevenLabs, so it needs the raw body.
  router.post("/voice/post-call", express.raw({ type: "*/*", limit: "2mb" }), (request, response) => {
    const secret = process.env.ELEVENLABS_WEBHOOK_SECRET;
    if (!secret) return response.status(503).json({ error: "ELEVENLABS_WEBHOOK_SECRET is not configured" });
    const raw = Buffer.isBuffer(request.body) ? request.body.toString("utf8") : "";
    const header = request.header("elevenlabs-signature") ?? "";
    const timestamp = /t=(\d+)/.exec(header)?.[1];
    const signature = /v0=([a-f0-9]+)/.exec(header)?.[1];
    const fresh = timestamp && Math.abs(Date.now() / 1000 - Number(timestamp)) < POST_CALL_TOLERANCE_SECONDS;
    const expected = timestamp ? createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex") : "";
    if (!fresh || !signature || !safeEqual(signature, expected)) return response.status(401).json({ error: "Invalid signature" });

    const payload = JSON.parse(raw) as { type?: string; data?: { conversation_id?: string; transcript?: { role?: string; message?: string | null }[] } };
    if (payload.type !== "post_call_transcription" || !payload.data?.conversation_id) return response.json({ ok: true, ignored: true });
    const conversationId = payload.data.conversation_id;
    for (const turn of payload.data.transcript ?? []) {
      if (!turn.message) continue;
      emit({ type: "call.transcript", conversationId, speaker: turn.role === "agent" ? "agent" : "caller", text: turn.message });
    }
    emit({ type: "audit", actor: "voice", action: "call.ended", detail: conversationId, ts: Date.now() });
    return response.json({ ok: true });
  });

  return router;
}
