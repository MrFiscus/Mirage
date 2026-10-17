import express, { type Express } from "express";
import { fileURLToPath } from "node:url";
import type { ConsoleEvent } from "./contracts.js";
import { onEvent } from "./core.js";
import { defenseRouter } from "./routes.js";

/** One-line hook for server/index.ts: mounts the defense routes and forwards engine events to the console sockets. */
export function mountDefense(app: Express, broadcast: (event: ConsoleEvent) => void): void {
  app.use(defenseRouter);
  // Judge-facing demo: ticketing view at /demo
  app.use("/demo", express.static(fileURLToPath(new URL("./demo-ui", import.meta.url))));
  onEvent(broadcast);
}
