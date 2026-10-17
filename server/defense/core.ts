// Adapter over Person 3's real core (server/core). Everything in the defense lane imports from here.
import type { ConsoleEvent } from "./contracts.js";
import { emit as coreEmit } from "../core/events.js";
import { PhotonMessenger } from "../voice/photon.js";

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
const photon = new PhotonMessenger();

/** Texts through Photon (PHOTON_MODE=mock only logs). Never blocks the run; a failed send becomes an audit line. */
export function sendSms(to: string, body: string): void {
  smsLog.push({ to, body });
  emit({ type: "sms.sent", to, body });
  photon.send(to, body).catch((e: Error) =>
    emit({ type: "audit", actor: "photon", action: "sms.failed", detail: e.message.slice(0, 200), ts: Date.now() }));
}
