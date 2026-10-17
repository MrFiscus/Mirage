import type { FixPlan } from "./contracts.js";

export interface FixPlanner { readonly name?: string; plan(scenario: string): Promise<FixPlan>; }

const CLEAN_COMMANDS = [
  'kill "$(cat .run/rogue.pid)"',
  "rm -f .run/rogue.pid",
  "cp .baseline/lib.cjs lib.cjs",
  // Portable on GNU and BSD/macOS (no sed -i); grep -v exits 1 when nothing is left, hence || true.
  "{ grep -v '10.0.0.99' logs/network.log || true; } > logs/network.log.tmp && mv logs/network.log.tmp logs/network.log",
  "rm -f cron/beacon.cron",
];

/** Scripted stand-in for the Factory Droid planner. Droid replaces it behind the same interface. */
export class ScriptedPlanner implements FixPlanner {
  readonly name = "scripted (Droid placeholder)";
  async plan(scenario: string): Promise<FixPlan> {
    switch (scenario) {
      case "1": return { commands: CLEAN_COMMANDS, drastic: true };             // needs APPROVE
      case "2": return { commands: [...CLEAN_COMMANDS, "rm -f config.json"], drastic: false }; // harmful, clone check must catch it
      case "3": return { commands: CLEAN_COMMANDS, drastic: false };            // low risk, auto-apply
      case "low": return { commands: ["rm -f cron/updater.cron"], drastic: false }; // demo low tier: auto-apply
      case "high": return { commands: CLEAN_COMMANDS, drastic: true };          // demo high tier: needs APPROVE
      default: throw new Error(`unknown scenario: ${scenario}`);
    }
  }
}
