// The attacker seam (Person A). All three attackers (scripted, droid, grok) expose this one interface so the harness
// and the watcher sit in the path regardless of which is running. The history is what the harness has recorded and
// executed so far; the attacker returns the next call, or null when it is done.
import type { CageToolCall } from "./types.js";

/** What the harness has observed for one executed step: the call plus the result it produced. */
export interface Observed {
  call: CageToolCall;
  /** decision the watcher returned, so a model attacker could react to a block/mirage. */
  decision: "pass" | "mirage" | "block";
  output: string;
  exitCode?: number;
}

export interface Attacker {
  readonly kind: "scripted" | "droid" | "grok";
  /** Return the next intended call, or null to stop. `step` is 1-based. The harness fills in id/session/step/ts. */
  nextStep(history: Observed[], step: number): Promise<NextCall | null>;
}

/** What an attacker proposes: just the tool and its args. The harness stamps id/session/step/ts. */
export type NextCall = Pick<CageToolCall, "tool" | "args" | "thought">;
