// Cage event bus + host-side forensic log (Person A).
// The core emit() in server/core/events.ts is typed to ConsoleEvent; the Mirage lanes speak MirageEvent. Rather than
// widen the shared type (which needs a team-chat message), the cage emits its own MirageEvents here and appends every
// one to a host-side JSONL. Person C will add one adapter that bridges these onto the WebSocket bus for the dashboard.
//
// The forensic log lives on the HOST, outside anything the agent can edit, and is written before each call runs
// (see harness.ts). That is the record detection reads — never the copy inside the sandbox.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { MirageEvent } from "./types.js";

type Listener = (event: MirageEvent) => void;

export class CageBus {
  private listeners = new Set<Listener>();

  constructor(readonly logPath?: string) {
    if (logPath) mkdirSync(dirname(logPath), { recursive: true });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: MirageEvent): void {
    if (this.logPath) {
      try {
        appendFileSync(this.logPath, JSON.stringify(event) + "\n");
      } catch {
        /* a full disk must not stop the run; the in-memory listeners still see it */
      }
    }
    for (const listener of this.listeners) listener(event);
  }
}
