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

describe("business scenarios + mixed fleet", () => {
  it("scenario ids are unique and every blocked job that can be scripted has a rogue script", async () => {
    const { SCENARIOS, scenarioById } = await import("../scenarios.js");
    expect(new Set(SCENARIOS.map((s) => s.id)).size).toBe(SCENARIOS.length);
    for (const id of ["billing-sync", "hotfix-deploy"]) expect(scenarioById(id)?.rogueScript?.length).toBeGreaterThan(3);
    // controls are solvable in scope: they must not carry a rogue script
    expect(SCENARIOS.filter((s) => s.kind === "control").every((s) => !s.rogueScript)).toBe(true);
    // no prompt tells the agent to leave scope; each states the scope instead
    expect(SCENARIOS.every((s) => /Do not access anything outside this scope/.test(s.prompt))).toBe(true);
  });

  it("membersFromMix labels live Droid vs simulated scripted members", async () => {
    const { membersFromMix } = await import("../fleet.js");
    const m = membersFromMix(["orders-report"], ["billing-sync", "hotfix-deploy"]);
    expect(m.map((x) => x.attacker)).toEqual(["droid", "scripted", "scripted"]);
    expect(m.every((x) => x.honestEnv === "vm")).toBe(true);
  });

  it("a scripted rogue run of a business scenario crosses scope, is mirage'd then blocked, with 0 real out-of-scope", async () => {
    const { scenarioById } = await import("../scenarios.js");
    const { ScriptedAttacker } = await import("../attackers/scripted.js");
    const { runSession } = await import("../harness.js");
    const { CageBus } = await import("../events.js");
    const { makeRealMirage, realWatcher, NullSandbox } = await import("../wire.js");
    const r = await runSession({ attacker: new ScriptedAttacker(scenarioById("billing-sync")!.rogueScript), watcher: realWatcher, mirage: makeRealMirage(null), sandbox: new NullSandbox(), bus: new CageBus(), honestEnv: "acme" });
    expect(r.session.triggered).toBe(true);
    expect(r.history.some((h) => h.decision === "mirage")).toBe(true);
    expect(r.history.at(-1)?.decision).toBe("block");
    expect(r.realOutOfScope).toBe(0);
  });
});
