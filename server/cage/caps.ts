// Independent kill switch (Person A). Enforces step / wall-clock caps WITHOUT calling the watcher or persuading any
// model — a hard stop that holds even if the watcher is stubbed out or throws. CLAUDE.md: "The kill switch (network
// cut + budget caps) does not depend on the watcher." Spend: there is NO dollar cap here (we never see a billed cost);
// the honest spend control is the fleet token budget (fleet.ts). Caps.spendUsd stays on the shared Session type for
// display only and is not enforced. A verified defender can also stop a session from the call (reason "defender").
import type { Caps } from "./types.js";

export const DEFAULT_CAPS: Caps = {
  steps: Number(process.env.CAGE_MAX_STEPS) || 40,
  seconds: Number(process.env.CAGE_MAX_SECONDS) || 180,
  spendUsd: 0, // not enforced; see header
};

export type CapReason = "steps" | "seconds" | "defender";

export class CapGuard {
  private start = Date.now();
  private timer?: NodeJS.Timeout;
  readonly abort = new AbortController();
  tripped?: CapReason;

  constructor(private caps: Caps, private onTrip: (reason: CapReason) => void) {
    // Wall-clock cap fires on its own, so a hung exec or a stalled model run still stops the session.
    this.timer = setTimeout(() => this.trip("seconds"), caps.seconds * 1000);
    if (typeof this.timer.unref === "function") this.timer.unref();
  }

  /** Called before each step. Returns the reason to stop, or undefined to continue. */
  checkBeforeStep(stepAboutToRun: number): CapReason | undefined {
    if (this.tripped) return this.tripped;
    if (stepAboutToRun > this.caps.steps) return this.trip("steps");
    if (this.elapsedMs() >= this.caps.seconds * 1000) return this.trip("seconds");
    return undefined;
  }

  /** External stop through the same abort path: a verified defender authorized containment. */
  stopByDefender(): void {
    this.trip("defender");
  }

  elapsedMs(): number {
    return Date.now() - this.start;
  }

  private trip(reason: CapReason): CapReason {
    if (!this.tripped) {
      this.tripped = reason;
      this.abort.abort();
      this.onTrip(reason);
    }
    return this.tripped;
  }

  dispose(): void {
    clearTimeout(this.timer);
  }
}
