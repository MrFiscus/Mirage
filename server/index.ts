import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import type { Incident } from "../shared/types.js";
import { emit, subscribe } from "./core/events.js";
import { getIncident, listAudit, listIncidents, saveIncident } from "./core/store.js";

const app = express();
const httpServer = createServer(app);
const sockets = new WebSocketServer({ server: httpServer, path: "/events" });
const port = Number(process.env.PORT ?? 8787);

app.use(express.json());
app.use(express.static("console"));

function publish(event: Parameters<typeof emit>[0]): void {
  emit(event);
  const payload = JSON.stringify(event);
  for (const socket of sockets.clients) {
    if (socket.readyState === 1) socket.send(payload);
  }
}

subscribe(() => undefined);

app.get("/api/health", (_request, response) => response.json({ ok: true, service: "batman-console" }));
app.get("/api/incidents", (_request, response) => response.json(listIncidents()));
app.get("/api/incidents/:id", (request, response) => {
  const incident = getIncident(request.params.id);
  if (!incident) return response.status(404).json({ error: "Incident not found" });
  return response.json(incident);
});
app.get("/api/audit", (_request, response) => response.json(listAudit()));

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
  socket.send(JSON.stringify({ type: "snapshot", incidents: listIncidents(), audit: listAudit(), sessionId: randomUUID() }));
});

httpServer.listen(port, () => console.log(`Batman console listening on http://localhost:${port}`));