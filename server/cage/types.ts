// Cage seam interfaces (Person A). The Mirage data contracts now live in shared/types.ts (they landed there
// via the mirage lane), so this file re-exports them and keeps only the two cage-local seam interfaces plus
// Caps (which shared keeps inline on Session). CageToolCall stays as an alias so existing cage code reads unchanged.
export * from "../../shared/types.js";
import type { LedgerEntry, Session, ToolCall, Verdict } from "../../shared/types.js";

/** @deprecated Use ToolCall from shared/types. Kept as an alias so cage code compiles unchanged. */
export type CageToolCall = ToolCall;

/** The step/time/spend caps (shared keeps this inline on Session; named here for the cage lane). */
export interface Caps {
  steps: number;
  seconds: number;
  spendUsd: number;
}

/** The watcher interface the harness calls before every tool call. Person B's real decide() adapts to this. */
export interface Watcher {
  decide(call: ToolCall, session: Session): Promise<Verdict>;
}

/** The mirage interface the harness calls for a `mirage` verdict. Person C's real Simulator adapts to this. */
export interface Mirage {
  serve(call: ToolCall, session: Session): Promise<LedgerEntry>;
}
