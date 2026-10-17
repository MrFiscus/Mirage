// Adapter over Person 3's real core (server/core). Everything in the defense lane imports from here.
import type { ConsoleEvent } from "./contracts.js";
import { emit as coreEmit } from "../core/events.js";

export { getIncident, saveIncident, lookupCaller } from "../core/store.js";

// Events emitted by the defense engine are also fanned out on this bus, so server/index.ts can
// forward just these to the console WebSocket without double-sending Person 3's own events.
const bus = new Set<(e: ConsoleEvent) => void>();
export const onEvent = (fn: (e: ConsoleEvent) => void) => { bus.add(fn); return () => { bus.delete(fn); }; };

export function emit(event: ConsoleEvent): void {
  coreEmit(event); // console audit log
  for (const fn of [...bus]) fn(event);
}

export const smsLog: { to: string; body: string }[] = [];

/** Stand-in for the Photon text until the real sender exists in the core. */
export function sendSms(to: string, body: string): void {
  smsLog.push({ to, body });
  emit({ type: "sms.sent", to, body });
}
