import type { Express } from "express";
import type { ConsoleEvent } from "./contracts.js";
import { onEvent } from "./core.js";
import { defenseRouter } from "./routes.js";

/** One-line hook for server/index.ts: mounts the defense routes and forwards engine events to the console sockets. */
export function mountDefense(app: Express, broadcast: (event: ConsoleEvent) => void): void {
  app.use(defenseRouter);
  onEvent(broadcast);
}
