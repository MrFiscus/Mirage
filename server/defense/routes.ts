import { Router } from "express";
import { approve } from "./approval";
import { startScenario } from "./orchestrator";
import { getIncident } from "./mocks/core";

export const defenseRouter = Router();

// "Start scenario" button. Responds as soon as the incident exists; progress arrives as ConsoleEvents.
defenseRouter.post("/defense/scenario/:id/start", async (req, res) => {
  try {
    const incident = await startScenario(req.params.id);
    res.json({ incidentId: incident.id, status: getIncident(incident.id)?.status });
  } catch (e) { res.status(400).json({ error: (e as Error).message }); }
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
