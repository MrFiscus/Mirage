import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { AuditEntry, CallSession, Caller, Incident } from "../../shared/types.js";

const dataRoot = resolve(process.cwd(), "data");
const statePath = resolve(dataRoot, "runtime-state.json");

interface RuntimeState {
  incidents: Incident[];
  sessions: CallSession[];
  audit: AuditEntry[];
}

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const initialIncidents = readJson<Incident[]>(resolve(dataRoot, "incidents.json"), []);
const state: RuntimeState = readJson<RuntimeState>(statePath, {
  incidents: initialIncidents,
  sessions: [],
  audit: []
});

function persist(): void {
  writeFileSync(statePath, JSON.stringify(state, null, 2));
}

export function getIncident(id: string): Incident | undefined {
  return state.incidents.find((incident) => incident.id === id);
}

export function listIncidents(): Incident[] {
  return [...state.incidents].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export function saveIncident(incident: Incident): Incident {
  const index = state.incidents.findIndex((item) => item.id === incident.id);
  if (index >= 0) state.incidents[index] = incident;
  else state.incidents.push(incident);
  persist();
  return incident;
}

export function getSession(conversationId: string): CallSession | undefined {
  return state.sessions.find((session) => session.conversationId === conversationId);
}

export function saveSession(session: CallSession): CallSession {
  const index = state.sessions.findIndex((item) => item.conversationId === session.conversationId);
  if (index >= 0) state.sessions[index] = session;
  else state.sessions.push(session);
  persist();
  return session;
}

export function addAudit(entry: AuditEntry): AuditEntry {
  state.audit.unshift(entry);
  state.audit = state.audit.slice(0, 200);
  persist();
  return entry;
}

export function listAudit(): AuditEntry[] {
  return [...state.audit];
}

export function lookupCaller(phone: string): Caller | null {
  const users = readJson<Caller[]>(resolve(dataRoot, "users.json"), []);
  return users.find((user) => user.phone === phone) ?? null;
}