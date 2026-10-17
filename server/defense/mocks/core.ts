// Stand-in for Person 3's shared core API. Delete this file when the real core lands
// and point imports in server/defense at it. Signatures match the CLAUDE.md contract.
import type { Caller, ConsoleEvent, Incident } from "../contracts.js";

const incidents = new Map<string, Incident>();
const listeners: ((e: ConsoleEvent) => void)[] = [];
export const eventLog: ConsoleEvent[] = [];
export const smsLog: { to: string; body: string }[] = [];

const USERS: Caller[] = [
  { phone: "+15550000001", name: "Dana Reyes", role: "ceo", department: "Executive" },
  { phone: "+15550000002", name: "Sam Okafor", role: "analyst", department: "Security" },
  { phone: "+15550000003", name: "Priya Nair", role: "hr", department: "People" },
];

export function onEvent(fn: (e: ConsoleEvent) => void): () => void {
  listeners.push(fn);
  return () => { listeners.splice(listeners.indexOf(fn), 1); };
}

export function emit(event: ConsoleEvent): void {
  eventLog.push(event);
  for (const fn of [...listeners]) fn(event);
}

export function getIncident(id: string): Incident | undefined { return incidents.get(id); }
export function saveIncident(incident: Incident): void { incidents.set(incident.id, structuredClone(incident)); }
export function lookupCaller(phone: string): Caller | null { return USERS.find((u) => u.phone === phone) ?? null; }

export function sendSms(to: string, body: string): void {
  smsLog.push({ to, body });
  emit({ type: "sms.sent", to, body });
}

export function resetMockCore(): void {
  incidents.clear(); eventLog.length = 0; smsLog.length = 0; listeners.length = 0;
}
