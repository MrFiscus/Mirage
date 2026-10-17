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
import { mirageRouter } from "./mirage/routes.js";
import { CageBus } from "./cage/events.js";
import { runSession } from "./cage/harness.js";
import { ScriptedAttacker, ACME_SCRIPT } from "./cage/attackers/scripted.js";
import { makeRealMirage, NullSandbox, realWatcher } from "./cage/wire.js";
import { runCageFleet } from "./cage/fleet.js";
import { planFleet, chooseConcurrency } from "./cage/fleet-plan.js";

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

// Mirage lane (Person C): honest env, simulator, ledger, progress, forensics + dashboard. Emits onto
// the core bus, which the subscription above already forwards to the console WebSocket.
app.use(mirageRouter);

// Cage lane (Person A): start one end-to-end run — scripted attacker → real watcher → real mirage, honest
// `pass` calls running in the in-process Acme world (no Daytona). The cage emits on its own CageBus; we bridge
// every MirageEvent onto the core bus so the dashboard renders the run live. ?watcher=off for the contrast run.
app.post("/cage/start", (request, response) => {
  const watcherOn = request.query.watcher !== "off";
  const bus = new CageBus(`data/cage-runs/${Date.now()}-dashboard.jsonl`);
  const unbridge = bus.subscribe((event) => publish(event));
  void runSession({
    attacker: new ScriptedAttacker(ACME_SCRIPT),
    watcher: realWatcher,
    mirage: makeRealMirage(null),
    sandbox: new NullSandbox(),
    bus,
    watcherOn,
    honestEnv: "acme",
  })
    .catch((error: Error) => publish({ type: "audit", actor: "cage", action: "run.failed", detail: error.message, ts: Date.now() }))
    .finally(() => unbridge());
  return response.status(202).json({ started: true, watcherOn });
});

// Cage fleet (Person A, System 3): N agents, each in its own real "vm" world, all watched by the one real watcher.
// Emits the same events the fleet UI already renders. The dashboard sends ?mode=live|mixed|scripted&n=N; the older
// ?live=N, ?real=&rogue= and ?droid=&scripted= forms still work (parsing + guards in cage/fleet-plan.ts). Reconciles
// with the all-scripted /mirage/fleet/start (Person C) — both compose runSession; this is the Droid/vm variant.
app.post("/cage/fleet/start", (request, response) => {
  const watcherOn = request.query.watcher !== "off";
  const plan = planFleet(request.query, process.env);
  if (!plan.ok) return response.status(plan.status).json({ error: plan.error });
  const { members } = plan;
  // How many agents run AT ONCE — bounded by Daytona CPU for scripted and by local RAM for live Droid (see
  // chooseConcurrency). Scripted-only fleets default to ~60 on Tier 3; any live-Droid fleet defaults to ~8 locally.
  const concurrency = chooseConcurrency(members, request.query as Record<string, unknown>, process.env);
  // Spend stop for big UI runs (~60k tokens per live Droid): ?tokenBudget=T, else CAGE_TOKEN_BUDGET, else none.
  // Once reached, no NEW agents start (running ones finish), and fleet.budget is emitted.
  const budget = Number(request.query.tokenBudget ?? process.env.CAGE_TOKEN_BUDGET);
  const tokenBudget = Number.isFinite(budget) && budget > 0 ? budget : undefined;
  void runCageFleet({ members, emit: publish, watcherOn, concurrency, tokenBudget })
    .catch((error: Error) => publish({ type: "audit", actor: "fleet", action: "fleet.failed", detail: error.message, ts: Date.now() }));
  return response.status(202).json({ started: true, mode: plan.mode, agents: members.length, live: members.filter((m) => m.attacker === "droid").length, simulated: members.filter((m) => m.attacker === "scripted").length, concurrency, tokenBudget: tokenBudget ?? null, watcherOn });
});

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