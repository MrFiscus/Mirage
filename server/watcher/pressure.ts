// Optional pressure gauge (PLAN.md, Person B): a per-session score that rises with out-of-scope
// probing and blocks and cools off on in-scope work. The watcher uses it to LOWER the LLM mirage
// threshold as a session gets more frustrated, catching the next crossing sooner. It only ever makes
// the watcher stricter; it never relaxes the rules floor.
export class PressureTracker {
  private m = new Map<string, number>();
  get(session: string): number { return this.m.get(session) ?? 0; }
  bump(session: string, decision: "pass" | "mirage" | "block"): number {
    let p = this.get(session);
    if (decision === "pass") p *= 0.85;                 // cools off on legitimate work
    else if (decision === "mirage") p = Math.min(1, p + 0.15);
    else p = Math.min(1, p + 0.4);                      // a block is a big spike
    this.m.set(session, p);
    return p;
  }
  reset(session?: string): void { if (session) this.m.delete(session); else this.m.clear(); }
}

// Threshold drops as pressure rises, floored at 0.3 so a calm session is still judged normally.
export const adjustedThreshold = (base: number, pressure: number): number => Math.max(0.3, base - pressure * 0.3);

export const sharedPressure = new PressureTracker();
