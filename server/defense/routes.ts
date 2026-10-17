import { Router } from "express";
import { approve, reject } from "./approval.js";
import { analystPhone } from "./apply.js";
import { audit, getTrace } from "./run.js";
import { getIncident } from "./core.js";
import { newIncidentId, startScenario } from "./orchestrator.js";
import { droidEnabled } from "./droid.js";

export const defenseRouter = Router();

const SCENARIOS = {
  "1": "Virus, fix passes the clone check, waits for analyst APPROVE",
  "2": "Virus, proposed fix is harmful, clone check rejects it",
  "3": "Virus, low-risk fix passes the clone check and auto-applies",
  low: "Low tier: malicious file download on Robin's PC, quarantined automatically",
  high: "High tier: sign-in from an unknown location, analyst approves locking the account",
  agent: "AI agent tier: a coding agent leaves its task and contacts decoys, analyst approves suspending it",
  "virus-low": "Server: unapproved scheduled task, fixed automatically",
  "virus-high": "Server: unknown program contacting an outside address, needs analyst approval",
} as const;

defenseRouter.get("/defense/info", (_req, res) =>
  res.json({
    backend: process.env.SANDBOX_BACKEND === "daytona" ? "daytona" : "local",
    investigator: process.env.INVESTIGATOR === "gemini" && process.env.GEMINI_API_KEY ? "gemini" : "rules",
    planner: droidEnabled() ? "droid" : "scripted (Droid placeholder)",
    photon: process.env.PHOTON_MODE === "live" ? "live" : "mock",
    voice: process.env.VOICE_MODE === "live" ? "live" : "mock",
    scenarios: SCENARIOS,
  }));

// "Start scenario": returns at once with the incident id; progress arrives as ConsoleEvents over the WebSocket.
defenseRouter.post("/defense/scenario/:id/start", (req, res) => {
  const scenario = req.params.id;
  if (!(scenario in SCENARIOS)) return res.status(400).json({ error: `unknown scenario: ${scenario}` });
  const incidentId = newIncidentId(scenario);
  startScenario(scenario, {}, incidentId).catch((e: Error) => audit("scenario.failed", e.message, "system"));
  res.status(202).json({ incidentId });
});

// Same function the inbound "APPROVE" text handler will call.
defenseRouter.post("/defense/approve", async (req, res) => {
  const { incidentId, phone } = req.body ?? {};
  if (typeof incidentId !== "string" || typeof phone !== "string") return res.status(400).json({ error: "incidentId and phone required" });
  try {
    await approve(incidentId, phone);
    res.json({ status: getIncident(incidentId)?.status });
  } catch (e) { res.status(403).json({ error: (e as Error).message }); }
});

// Demo button: stands in for the analyst texting APPROVE (the phone number never comes from the browser).
defenseRouter.post("/defense/demo-approve/:incidentId", async (req, res) => {
  try {
    await approve(req.params.incidentId, analystPhone());
    res.json({ status: getIncident(req.params.incidentId)?.status });
  } catch (e) { res.status(409).json({ error: (e as Error).message }); }
});

// Demo button: the analyst declines the fix.
defenseRouter.post("/defense/demo-reject/:incidentId", async (req, res) => {
  try {
    await reject(req.params.incidentId, analystPhone());
    res.json({ status: getIncident(req.params.incidentId)?.status });
  } catch (e) { res.status(409).json({ error: (e as Error).message }); }
});

// Step-by-step record of one run (timings, what Gemini was sent and answered, guardrail outcome) for /demo/explain.
defenseRouter.get("/defense/trace/:incidentId", (req, res) => {
  // null (not 404) for runs from before this server started, so pages loading old tickets stay quiet.
  res.json(getTrace(req.params.incidentId) ?? null);
});
