import { describe, expect, it } from "vitest";
// The /cage/fleet/start query parser (Person A). Covers the three dashboard modes, the FACTORY_API_KEY refusal for
// live modes, the n validation, the notifier guard, and that the legacy forms still parse.
import { planFleet, chooseConcurrency, modeSplit, BLOCKED_SCENARIOS, ROGUE_SCENARIOS, NOTIFIER_LIVE_MAX_AGENTS } from "../fleet-plan.js";
import type { FleetMember } from "../fleet.js";

const droids = (n: number): FleetMember[] => Array.from({ length: n }, () => ({ attacker: "droid" as const, honestEnv: "vm" as const }));
const scripts = (n: number): FleetMember[] => Array.from({ length: n }, () => ({ attacker: "scripted" as const, honestEnv: "vm" as const }));

const KEY = { FACTORY_API_KEY: "test-key" };
const kinds = (members: FleetMember[]) => members.map((m) => m.attacker);
const live = (members: FleetMember[]) => members.filter((m) => m.attacker === "droid").length;
const scripted = (members: FleetMember[]) => members.filter((m) => m.attacker === "scripted").length;

describe("planFleet: mode parsing", () => {
  it("mode=live builds N live Droid members on the flag hunt", () => {
    const plan = planFleet({ mode: "live", n: "4" }, KEY);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.mode).toBe("live");
    expect(plan.members).toHaveLength(4);
    expect(live(plan.members)).toBe(4);
    expect(plan.members.every((m) => m.scenario === "eval-rerun" && m.honestEnv === "vm")).toBe(true);
  });

  it("mode=scripted builds N scripted members cycling the rogue scenarios, needing no key", () => {
    const plan = planFleet({ mode: "scripted", n: "3" }, {});
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(scripted(plan.members)).toBe(3);
    expect(live(plan.members)).toBe(0);
    expect(plan.members.every((m) => ROGUE_SCENARIOS.includes(m.scenario!))).toBe(true);
  });

  it("mode=mixed splits ceil/floor and interleaves the two kinds", () => {
    const plan = planFleet({ mode: "mixed", n: "5" }, KEY);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(live(plan.members)).toBe(3); // ceil(5/2)
    expect(scripted(plan.members)).toBe(2); // floor(5/2)
    // interleaved so a VM-limited run starts both kinds early
    expect(kinds(plan.members).slice(0, 4)).toEqual(["droid", "scripted", "droid", "scripted"]);
    expect(plan.members.filter((m) => m.attacker === "droid").every((m) => BLOCKED_SCENARIOS.includes(m.scenario!))).toBe(true);
    expect(plan.members.filter((m) => m.attacker === "scripted").every((m) => ROGUE_SCENARIOS.includes(m.scenario!))).toBe(true);
  });

  it("refuses live and mixed without FACTORY_API_KEY, never silently scripting", () => {
    expect(planFleet({ mode: "live", n: "2" }, {})).toMatchObject({ ok: false, status: 503 });
    expect(planFleet({ mode: "mixed", n: "2" }, {})).toMatchObject({ ok: false, status: 503 });
    // scripted is allowed with no key
    expect(planFleet({ mode: "scripted", n: "2" }, {}).ok).toBe(true);
  });

  it("rejects a bad n and an unknown mode", () => {
    expect(planFleet({ mode: "live", n: "0" }, KEY)).toMatchObject({ ok: false, status: 400 });
    expect(planFleet({ mode: "live", n: "x" }, KEY)).toMatchObject({ ok: false, status: 400 });
    expect(planFleet({ mode: "nope", n: "2" }, KEY)).toMatchObject({ ok: false, status: 400 });
  });

  it("handles a 1000-agent request", () => {
    const plan = planFleet({ mode: "scripted", n: "1000" }, {});
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.members).toHaveLength(1000);
  });
});

describe("planFleet: notifier guard and legacy forms", () => {
  it("refuses >max agents only while the notifier is live", () => {
    const big = { mode: "scripted", n: String(NOTIFIER_LIVE_MAX_AGENTS + 1) };
    expect(planFleet(big, { PHOTON_MODE: "live" })).toMatchObject({ ok: false, status: 409 });
    expect(planFleet(big, { VOICE_MODE: "live" })).toMatchObject({ ok: false, status: 409 });
    expect(planFleet(big, {}).ok).toBe(true); // mock notifier: allowed
  });

  it("a bare request defaults to live Droid; without a key it is scripted and says so", () => {
    const live3 = planFleet({}, KEY);
    expect(live3).toMatchObject({ ok: true, mode: "live" });
    if (live3.ok) expect(kinds(live3.members)).toEqual(["droid", "droid", "droid"]);
    const noKey = planFleet({ n: "2" }, {});
    expect(noKey).toMatchObject({ ok: true, mode: "scripted" });
    if (noKey.ok) expect(kinds(noKey.members)).toEqual(["scripted", "scripted"]);
  });

  it("still parses ?live=N and the counts form", () => {
    expect(planFleet({ live: "3" }, KEY)).toMatchObject({ ok: true, mode: "legacy" });
    expect(planFleet({ live: "3" }, {})).toMatchObject({ ok: false, status: 503 });
    const counts = planFleet({ droid: "2", scripted: "1" }, KEY);
    expect(counts.ok).toBe(true);
    if (counts.ok) expect(counts.members).toHaveLength(3);
  });
});

describe("chooseConcurrency: CPU budget for scripted, local RAM cap for live Droid", () => {
  const KEYED = { FACTORY_API_KEY: "k" };

  it("scripted-only defaults to the CPU budget (250/4 - headroom = 60 on Tier 3)", () => {
    expect(chooseConcurrency(scripts(1000), {}, KEYED)).toBe(60);
  });

  it("any live Droid in the fleet drops the default to the local cap (8)", () => {
    expect(chooseConcurrency(droids(1000), {}, KEYED)).toBe(8);
    // mixed also counts as having live Droid
    expect(chooseConcurrency([...droids(500), ...scripts(500)], {}, KEYED)).toBe(8);
  });

  it("without a Factory key, droid members fall back to scripted, so the CPU budget applies", () => {
    expect(chooseConcurrency(droids(1000), {}, {})).toBe(60);
  });

  it("?concurrency overrides either default", () => {
    expect(chooseConcurrency(droids(1000), { concurrency: "20" }, KEYED)).toBe(20);
    expect(chooseConcurrency(scripts(1000), { concurrency: "5" }, KEYED)).toBe(5);
  });

  it("CAGE_MAX_VMS overrides the scripted default but CAGE_MAX_LIVE_DROID caps live Droid", () => {
    expect(chooseConcurrency(scripts(1000), {}, { ...KEYED, CAGE_MAX_VMS: "30" })).toBe(30);
    expect(chooseConcurrency(droids(1000), {}, { ...KEYED, CAGE_MAX_LIVE_DROID: "4" })).toBe(4);
  });

  it("scales with the CPU budget and never exceeds the fleet size or drops below 1", () => {
    expect(chooseConcurrency(scripts(1000), {}, { ...KEYED, CAGE_CPU_BUDGET: "1000", CAGE_VCPU_PER_VM: "4" })).toBe(248);
    expect(chooseConcurrency(scripts(5), {}, KEYED)).toBe(5); // capped to the fleet
    expect(chooseConcurrency(scripts(1), {}, KEYED)).toBe(1);
  });
});

describe("modeSplit mirrors the UI", () => {
  it("live/scripted/mixed", () => {
    expect(modeSplit("live", 6)).toEqual({ live: 6, simulated: 0 });
    expect(modeSplit("scripted", 6)).toEqual({ live: 0, simulated: 6 });
    expect(modeSplit("mixed", 7)).toEqual({ live: 4, simulated: 3 });
  });
});
