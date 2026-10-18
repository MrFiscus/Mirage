// Mirage lane routes. Mounted by server/index.ts. Everything emits onto the core bus, which the
// server already forwards to the console WebSocket, so the dashboard updates live.
//
// The demo runs through the cage (POST /cage/start, POST /cage/fleet/start in server/index.ts). The mock run here
// is kept for the voice lane's offline notification smoke test and for tests; it is not a second demo spine.
import { Router } from "express";
import { resolve } from "node:path";
import { emit } from "../core/events.js";
import type { MirageEvent } from "../../shared/types.js";
import { runMock } from "./mock.js";
import { DEFAULT_SCOPE, TASK_PROMPT } from "./acme.js";
import { getSummary, listSummaries } from "../cage/runs.js";

const LEDGER_FILE = resolve(process.cwd(), "data", "mirage-ledger.jsonl");

export const mirageRouter = Router();

mirageRouter.get("/mirage/info", (_req, res) =>
  res.json({ task: TASK_PROMPT, scope: DEFAULT_SCOPE, ledger: LEDGER_FILE }));

// Start a scripted mock run through the MirageEngine (watcher on by default; ?watcher=off for the contrast run).
mirageRouter.post("/mirage/mock/start", (req, res) => {
  const watcherOn = req.query.watcher !== "off" && req.body?.watcher !== "off";
  const stepMs = Number(req.query.stepMs ?? req.body?.stepMs ?? 700);
  void runMock({ emit: emit as (e: MirageEvent) => void, watcherOn, stepMs, ledgerFile: LEDGER_FILE })
    .catch((e: Error) => emit({ type: "audit", actor: "mirage", action: "mock.failed", detail: e.message, ts: Date.now() }));
  res.status(202).json({ started: true, watcherOn });
});

// Forensic summaries of cage sessions (the run.summary each session emitted when it ended).
mirageRouter.get("/mirage/forensics/:id", (req, res) => {
  const s = getSummary(req.params.id);
  if (!s) return res.status(404).json({ error: "no such session" });
  res.json(s);
});

mirageRouter.get("/mirage/forensics", (_req, res) => {
  res.json(listSummaries()[0] ?? null);
});
