// Registry of sessions currently running in this process (Person A). The verified-defender lane
// (server/voice, POST /cage/sessions/:id/contain) stops a session through here. It goes through the same abort path
// as the caps (CapGuard.stopByDefender), so containment never depends on the watcher or on persuading the agent.
export interface ActiveSession {
  id: string;
  attacker: string;
  startedAt: number;
  /** Trip the session: the loop stops, contain() runs, kill + run.summary are emitted. */
  stop: () => void;
}

const active = new Map<string, ActiveSession>();

export function registerActive(s: ActiveSession): () => void {
  active.set(s.id, s);
  return () => { active.delete(s.id); };
}

export const getActive = (id: string): ActiveSession | undefined => active.get(id);
export const listActive = (): ActiveSession[] => [...active.values()];
