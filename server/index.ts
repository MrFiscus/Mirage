import "dotenv/config";
import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import type { Incident } from "../shared/types.js";
import { emit, subscribe } from "./core/events.js";
import { getIncident, listAudit, listIncidents, listSessions, saveIncident } from "./core/store.js";
import { PhotonMessenger } from "./voice/photon.js";
import { VerificationService } from "./voice/verification.js";
import { getVoiceReadiness } from "./voice/elevenlabs.js";
import { voiceRouter } from "./voice/routes.js";
import { mountDefense } from "./defense/mount.js";

const app = express();
const httpServer = createServer(app);
const sockets = new WebSocketServer({ server: httpServer, path: "/events" });
const port = Number(process.env.PORT ?? 8787);
const verification = new VerificationService(new PhotonMessenger());

// Mounted before the global JSON parser: the post-call webhook needs the raw body for its signature.
app.use(voiceRouter(verification));
app.use(express.json());
app.use(express.static("console"));

// Every event on the bus reaches the console, including those emitted from voice and defense modules.
subscribe((event) => {
  const payload = JSON.stringify(event);
  for (const socket of sockets.clients) {
    if (socket.readyState === 1) socket.send(payload);
  }
});
const publish = emit;

// Defense engine (Person 2): routes. Its events already go through core emit, which the
// subscription above broadcasts, so forwarding them here again would double-send.
mountDefense(app, () => undefined);

app.get("/api/health", (_request, response) => response.json({ ok: true, service: "batman-console" }));
app.get("/api/voice/readiness", (_request, response) => response.json(getVoiceReadiness()));
app.get("/api/incidents", (_request, response) => response.json(listIncidents()));
app.get("/api/incidents/:id", (request, response) => {
  const incident = getIncident(request.params.id);
  if (!incident) return response.status(404).json({ error: "Incident not found" });
  return response.json(incident);
});
app.get("/api/audit", (_request, response) => response.json(listAudit()));
app.get("/api/calls", (_request, response) => response.json(listSessions()));
app.post("/api/verification/request", async (request, response) => {
  const phone = typeof request.body?.phone === "string" ? request.body.phone : "";
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return response.status(400).json({ error: "Phone must be an E.164 number" });
  const result = await verification.request(phone);
  if (!result.sent) return response.status(404).json({ error: "Caller not found" });
  return response.json({ sent: true, role: result.caller?.role });
});
app.post("/api/verification/verify", (request, response) => {
  const phone = typeof request.body?.phone === "string" ? request.body.phone : "";
  const code = typeof request.body?.code === "string" ? request.body.code : "";
  if (!/^\+[1-9]\d{7,14}$/.test(phone) || !/^\d{6}$/.test(code)) return response.status(400).json({ verified: false });
  return response.json({ verified: verification.verify(phone, code) === "matched" });
});

app.post("/api/demo/start", (_request, response) => {
  const source = listIncidents()[0];
  if (!source) return response.status(500).json({ error: "No synthetic incident configured" });
  const incident: Incident = {
    ...source,
    id: `INC-DEMO-${Date.now()}`,
    status: "detected",
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  saveIncident(incident);
  publish({ type: "audit", actor: "demo", action: "scenario.started", detail: incident.id, ts: Date.now() });
  publish({ type: "incident.updated", incident });
  return response.status(201).json(incident);
});

app.post("/api/incidents/:id/advance", (request, response) => {
  const incident = getIncident(request.params.id);
  if (!incident) return response.status(404).json({ error: "Incident not found" });
  const next = String(request.body?.status ?? "investigating") as Incident["status"];
  const allowed: Incident["status"][] = ["detected", "investigating", "testing_fix", "awaiting_approval", "resolved", "fix_rejected"];
  if (!allowed.includes(next)) return response.status(400).json({ error: "Unknown incident status" });
  const updated = saveIncident({ ...incident, status: next, updatedAt: Date.now() });
  publish({ type: "incident.updated", incident: updated });
  publish({ type: "audit", actor: "console", action: "incident.status_changed", detail: `${incident.id} -> ${next}`, ts: Date.now() });
  return response.json(updated);
});

sockets.on("connection", (socket) => {
  socket.send(JSON.stringify({ type: "snapshot", incidents: listIncidents(), audit: listAudit(), sessions: listSessions(), sessionId: randomUUID() }));
});

httpServer.listen(port, () => console.log(`Batman console listening on http://localhost:${port}`));