import { Router } from "express";
import { approve } from "./approval.js";
import { analystPhone } from "./apply.js";
import { audit } from "./run.js";
import { getIncident } from "./core.js";
import { newIncidentId, startScenario } from "./orchestrator.js";

export const defenseRouter = Router();

const SCENARIOS = {
  "1": "Virus, fix passes the clone check, waits for analyst APPROVE",
  "2": "Virus, proposed fix is harmful, clone check rejects it",
  "3": "Virus, low-risk fix passes the clone check and auto-applies",
} as const;

defenseRouter.get("/defense/info", (_req, res) =>
  res.json({ backend: process.env.SANDBOX_BACKEND === "daytona" ? "daytona" : "local", scenarios: SCENARIOS }));

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
