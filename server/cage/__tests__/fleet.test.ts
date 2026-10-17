import { describe, expect, it } from "vitest";
// System 3 offline: the demo fleet composed on runSession, using the in-process acme env (no Daytona) so it runs
// anywhere. Covers the scripted members, the Droid->scripted fallback when FACTORY_API_KEY is absent, and that the
// fleet emits the events the dashboard groups by (session.started + the fleet.* audits), one session per member.
import type { MirageEvent } from "../../../shared/types.js";
import { membersFromCounts, runCageFleet } from "../fleet.js";

function collect() {
  const events: MirageEvent[] = [];
  return { emit: (e: MirageEvent) => events.push(e), events };
}

describe("System 3: cage fleet (offline, acme env)", () => {
  it("runs every member as its own session and brackets the run with fleet.starting/complete", async () => {
    const { emit, events } = collect();
    const members = membersFromCounts(0, 3, "acme"); // 3 scripted, no VMs
    await runCageFleet({ members, emit, caps: { steps: 40, seconds: 30, spendUsd: 1 } });

    const starts = events.filter((e) => e.type === "session.started");
    expect(starts.length).toBe(3);
    expect(new Set(starts.map((e) => (e as Extract<MirageEvent, { type: "session.started" }>).session.id)).size).toBe(3); // distinct sessions
    expect(events.some((e) => e.type === "audit" && e.action === "fleet.starting")).toBe(true);
    expect(events.some((e) => e.type === "audit" && e.action === "fleet.complete")).toBe(true);
    // each scripted session reaches the watcher and gets routed (pass/mirage/block verdicts appear)
    expect(events.some((e) => e.type === "watcher.verdict")).toBe(true);
  });

  it("a droid member with no FACTORY_API_KEY falls back to scripted and says so", async () => {
    const hadKey = process.env.FACTORY_API_KEY;
    delete process.env.FACTORY_API_KEY;
    try {
      const { emit, events } = collect();
      await runCageFleet({ members: membersFromCounts(1, 0, "acme"), emit, caps: { steps: 40, seconds: 30, spendUsd: 1 } });
      expect(events.some((e) => e.type === "audit" && e.action === "droid.fallback")).toBe(true);
      expect(events.filter((e) => e.type === "session.started").length).toBe(1); // still a live session
    } finally {
      if (hadKey) process.env.FACTORY_API_KEY = hadKey;
    }
  });

  it("membersFromCounts builds the right mix", () => {
    expect(membersFromCounts(2, 1, "vm")).toEqual([
      { attacker: "droid", honestEnv: "vm" },
      { attacker: "droid", honestEnv: "vm" },
      { attacker: "scripted", honestEnv: "vm" },
    ]);
  });
});
