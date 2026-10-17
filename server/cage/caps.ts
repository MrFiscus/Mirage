// Independent kill switch (Person A). Enforces step / wall-clock / spend caps WITHOUT calling the watcher or
// persuading any model — a hard stop that holds even if the watcher is stubbed out or throws. CLAUDE.md: "The kill
// switch (network cut + budget caps) does not depend on the watcher."
import type { Caps } from "./types.js";

export const DEFAULT_CAPS: Caps = {
  steps: Number(process.env.CAGE_MAX_STEPS) || 40,
  seconds: Number(process.env.CAGE_MAX_SECONDS) || 180,
  spendUsd: Number(process.env.CAGE_MAX_SPEND_USD) || 1,
};

export type CapReason = "steps" | "seconds" | "spend";

export class CapGuard {
  private start = Date.now();
  private spent = 0;
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
    if (this.spent >= this.caps.spendUsd) return this.trip("spend");
    return undefined;
  }

  /** Record spend reported by a model attacker (Droid/Grok). Scripted runs report 0. */
  addSpend(usd: number): void {
    if (usd > 0) this.spent += usd;
    if (this.spent >= this.caps.spendUsd) this.trip("spend");
  }

  elapsedMs(): number {
    return Date.now() - this.start;
  }

  spendUsd(): number {
    return this.spent;
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
