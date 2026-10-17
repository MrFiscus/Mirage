import type { ConsoleEvent } from "../../shared/types.js";
import { addAudit } from "./store.js";

type Listener = (event: ConsoleEvent) => void;
const listeners = new Set<Listener>();

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emit(event: ConsoleEvent): void {
  if (event.type === "audit") {
    addAudit({ actor: event.actor, action: event.action, detail: event.detail, ts: event.ts });
  }
  for (const listener of listeners) listener(event);
}