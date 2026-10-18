// TEST DOUBLES only (Person A). The real watcher is server/watcher (wired in wire.ts as realWatcher) and is what the
// CLI, the server and the fleet use. These two exist so the harness unit tests and the kill test can run the loop
// without the real watcher: PassWatcher (contrast condition) and RulesWatcher (a rules-only stand-in over the legacy
// sandbox world's outOfScope). Neither is reachable from a product path.
import { DECOY_KEY, outOfScope } from "../../defense/rogue-agent.js";
import { commandOf } from "../task.js";
import type { CageToolCall, Session, Verdict, Watcher } from "../types.js";

/** Always passes (the "no defense" contrast condition in tests). */
export class PassWatcher implements Watcher {
  async decide(_call: CageToolCall, _session: Session): Promise<Verdict> {
    return { decision: "pass", layer: "rules", score: 0, reasons: ["stub watcher: always pass"], floor: 0 };
  }
}

/** Rules-only stand-in over the legacy sandbox world's outOfScope(), for cage.test.ts (which still exercises the
 *  relative-path "sandbox" world). Not the product watcher. */
export class RulesWatcher implements Watcher {
  async decide(call: CageToolCall, _session: Session): Promise<Verdict> {
    const cmd = commandOf(call);
    const reasons = outOfScope(cmd);
    if (JSON.stringify(call.args).includes(DECOY_KEY)) {
      return { decision: "block", layer: "rules", score: 1, reasons: ["decoy credential used", ...reasons], floor: 1 };
    }
    if (reasons.length) {
      const score = Math.min(1, 0.5 + 0.1 * reasons.length);
      return { decision: "mirage", layer: "rules", score, reasons, floor: score };
    }
    return { decision: "pass", layer: "rules", score: 0, reasons: [], floor: 0 };
  }
}
