import type { FixPlan } from "./contracts.js";

export interface FixPlanner { plan(scenario: string): Promise<FixPlan>; }

const CLEAN_COMMANDS = [
  'kill "$(cat .run/rogue.pid)"',
  "rm -f .run/rogue.pid",
  "cp .baseline/lib.cjs lib.cjs",
  "sed -i '/10.0.0.99/d' logs/network.log",
  "rm -f cron/beacon.cron",
];

/** Scripted stand-in for the Factory Droid planner. Droid replaces it behind the same interface. */
export class ScriptedPlanner implements FixPlanner {
  async plan(scenario: string): Promise<FixPlan> {
    switch (scenario) {
      case "1": return { commands: CLEAN_COMMANDS, drastic: true };             // needs APPROVE
      case "2": return { commands: [...CLEAN_COMMANDS, "rm -f config.json"], drastic: false }; // harmful, clone check must catch it
      case "3": return { commands: CLEAN_COMMANDS, drastic: false };            // low risk, auto-apply
      default: throw new Error(`unknown scenario: ${scenario}`);
    }
  }
}
