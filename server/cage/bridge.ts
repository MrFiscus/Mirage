// Agent bridge (Person A). A live agent like Factory Droid runs its OWN loop and calls our tools; the harness runs a
// loop that PULLS calls via attacker.nextStep(). The bridge joins the two without hooking inside the agent:
//   agent side   — each MCP tool handler calls request(call) and awaits the result string;
//   harness side — nextStep() takes the next queued call, and on the following nextStep() hands the harness's
//                  observed output back to the agent call that is still waiting.
// So a Droid call goes through exactly the same path as a scripted one: host-side record → watcher.decide →
// pass / mirage / block → caps. The agent only ever sees the output string, never the watcher's decision.
import type { NextCall, Observed } from "./attacker.js";

interface Pending {
  call: NextCall;
  resolve: (output: string) => void;
}

/** Shown to the agent for any call still open when the session ends (cap, block, or the agent stopping). */
const ENDED = "error: tool unavailable (connection reset)";

export class AgentBridge {
  private queue: Pending[] = [];
  private inFlight: Pending | null = null;
  private taker: ((p: Pending | null) => void) | null = null;
  private done = false;

  /** Agent side: submit one tool call, resolve with what the harness observed. */
  request(call: NextCall): Promise<string> {
    if (this.done) return Promise.resolve(ENDED);
    return new Promise<string>((resolve) => {
      const p: Pending = { call, resolve };
      if (this.taker) {
        const t = this.taker;
        this.taker = null;
        t(p);
      } else {
        this.queue.push(p);
      }
    });
  }

  /** Agent side: the agent's run ended (finished, failed, or aborted). Any waiting nextStep() returns null. */
  finish(): void {
    if (this.done) return;
    this.done = true;
    this.inFlight?.resolve(ENDED);
    this.inFlight = null;
    for (const p of this.queue.splice(0)) p.resolve(ENDED);
    if (this.taker) {
      const t = this.taker;
      this.taker = null;
      t(null);
    }
  }

  /** Harness side: return the previous call's result to the agent, then wait for its next call (null = done). */
  async take(history: Observed[], signal?: AbortSignal): Promise<NextCall | null> {
    if (this.inFlight) {
      const last = history[history.length - 1];
      this.inFlight.resolve(last ? formatForAgent(last) : ENDED);
      this.inFlight = null;
    }
    if (signal?.aborted) return null;
    const next =
      this.queue.shift() ??
      (this.done
        ? null
        : await new Promise<Pending | null>((resolve) => {
            this.taker = resolve;
            signal?.addEventListener("abort", () => {
              if (this.taker === resolve) this.taker = null;
              resolve(null);
            }, { once: true });
          }));
    if (!next) return null;
    this.inFlight = next;
    return next.call;
  }
}

/** What the agent gets back. Deliberately omits the verdict: a mirage reply must look like any other reply. */
export function formatForAgent(o: Observed): string {
  const out = o.output || "(no output)";
  return o.exitCode !== undefined && o.exitCode !== 0 ? `${out}\n[exit code ${o.exitCode}]` : out;
}
