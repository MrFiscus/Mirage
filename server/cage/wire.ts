// Wiring (Person A): drops the real watcher and the real mirage simulator into the cage's seam interfaces,
// plus a no-op sandbox for the in-process Acme honest env (so a scripted run needs no Daytona and runs on Windows).
import type { ExecResult, Sandbox } from "../defense/sandbox/index.js";
import { decide } from "../watcher/index.js";
import { Simulator } from "../mirage/simulator.js";
import type { LedgerEntry, Mirage, Session, ToolCall, Watcher } from "./types.js";

/** Person B's real decide(), adapted to the cage Watcher interface. emitEvent:false because the cage bus already
 *  emits watcher.verdict onto the core bus — this avoids a double emission. The rules floor + LLM layer + pressure
 *  gauge all run inside decide(). */
export const realWatcher: Watcher = {
  decide: (call: ToolCall, session: Session) => decide(call, session, { emitEvent: false }),
};

/** Person C's real Simulator, adapted to the cage Mirage interface. One instance per run keeps the world ledger
 *  and progress controller consistent across the session. */
export function makeRealMirage(ledgerFile?: string | null): Mirage {
  const sim = new Simulator({ ledgerFile: ledgerFile ?? null });
  return {
    async serve(call: ToolCall, _session: Session): Promise<LedgerEntry> {
      return sim.serve(call);
    },
  };
}

/** A sandbox that does nothing. Used when the honest `pass` env is the in-process Acme world (honestEnv: "acme"),
 *  so the run touches no Daytona/Local sandbox. Containment against it is a harmless no-op. */
export class NullSandbox implements Sandbox {
  readonly id = "null";
  async exec(): Promise<ExecResult> { return { code: 0, stdout: "", stderr: "" }; }
  async runScript(): Promise<ExecResult> { return { code: 0, stdout: "", stderr: "" }; }
  async readFile(): Promise<string> { return ""; }
  async clone(): Promise<Sandbox> { return new NullSandbox(); }
  async destroy(): Promise<void> { /* nothing to tear down */ }
}
