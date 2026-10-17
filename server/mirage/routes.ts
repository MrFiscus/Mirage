// Mirage lane routes. Mounted by server/index.ts. Everything emits onto the core bus, which the
// server already forwards to the console WebSocket, so the dashboard updates live.
import { Router } from "express";
import { resolve } from "node:path";
import { emit } from "../core/events.js";
import type { MirageEvent } from "../../shared/types.js";
import { MirageEngine } from "./engine.js";
import { runFleet, runMock } from "./mock.js";
import { runFleetDaytona } from "./fleet-daytona.js";
import { DEFAULT_SCOPE, TASK_PROMPT } from "./acme.js";
import { fleetSize } from "./fleet-size.js";

const LEDGER_FILE = resolve(process.cwd(), "data", "mirage-ledger.jsonl");

// Keep the most recent engines so /mirage/forensics can report them after the run ends.
const recent = new Map<string, MirageEngine>();
function remember(engine: MirageEngine) {
  recent.set(engine.session.id, engine);
  if (recent.size > 10) recent.delete(recent.keys().next().value!);
}

export const mirageRouter = Router();

mirageRouter.get("/mirage/info", (_req, res) =>
  res.json({ task: TASK_PROMPT, scope: DEFAULT_SCOPE, ledger: LEDGER_FILE }));

// Start a scripted mock run (watcher on by default; ?watcher=off for the contrast run).
mirageRouter.post("/mirage/mock/start", (req, res) => {
  const watcherOn = req.query.watcher !== "off" && req.body?.watcher !== "off";
  const stepMs = Number(req.query.stepMs ?? req.body?.stepMs ?? 700);
  const p = runMock({ emit: emit as (e: MirageEvent) => void, watcherOn, stepMs, ledgerFile: LEDGER_FILE })
    .then((engine) => { remember(engine); return engine; })
    .catch((e: Error) => emit({ type: "audit", actor: "mirage", action: "mock.failed", detail: e.message, ts: Date.now() }));
  void p;
  res.status(202).json({ started: true, watcherOn });
});

// Start a FLEET of scripted agents at once, all watched by the one real watcher (?n=6).
mirageRouter.post("/mirage/fleet/start", (req, res) => {
  let n: number;
  try {
    n = fleetSize(req.query.n ?? req.body?.n ?? 6);
  } catch (error) {
    return res.status(400).json({ error: (error as Error).message });
  }
  const watcherOn = req.query.watcher !== "off" && req.body?.watcher !== "off";
  const real = req.query.backend === "daytona" || req.body?.backend === "daytona";
  if (real) {
    void runFleetDaytona(n).catch((e: Error) => emit({ type: "audit", actor: "fleet", action: "fleet.failed", detail: e.message, ts: Date.now() }));
  } else {
    void runFleet({ emit: emit as (e: MirageEvent) => void, n, watcherOn })
      .catch((e: Error) => emit({ type: "audit", actor: "mirage", action: "mock.failed", detail: e.message, ts: Date.now() }));
  }
  res.status(202).json({ started: true, n, backend: real ? "daytona" : "sessions" });
});

mirageRouter.get("/mirage/forensics/:id", (req, res) => {
  const engine = recent.get(req.params.id);
  if (!engine) return res.status(404).json({ error: "no such session" });
  res.json(engine.forensics());
});

mirageRouter.get("/mirage/forensics", (_req, res) => {
  const latest = [...recent.values()].at(-1);
  res.json(latest ? latest.forensics() : null);
});
