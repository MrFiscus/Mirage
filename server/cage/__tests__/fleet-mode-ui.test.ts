import { describe, expect, it } from "vitest";
import { HOST_NAMES, hostnameFor } from "../../../console/fleet-mode.js";

describe("fleet host names", () => {
  it("has 50 distinct names and labels VMs like office machines", () => {
    expect(HOST_NAMES).toHaveLength(50);
    expect(new Set(HOST_NAMES).size).toBe(50);
    expect(hostnameFor(0)).toBe("ava.PC@coffee.org");
    expect(hostnameFor(49)).toBe("bruno.PC@coffee.org");
    expect(new Set(Array.from({ length: 50 }, (_, i) => hostnameFor(i))).size).toBe(50);
  });
  it("past 50 the name repeats with a round number, still unique", () => {
    expect(hostnameFor(50)).toBe("ava2.PC@coffee.org");
    expect(hostnameFor(99)).toBe("bruno2.PC@coffee.org");
    expect(hostnameFor(100)).toBe("ava3.PC@coffee.org");
    expect(new Set(Array.from({ length: 1000 }, (_, i) => hostnameFor(i))).size).toBe(1000);
  });
});
// The console's pure fleet-mode helpers (Person A touched console/). The badge comes ONLY from session.attacker, so a
// scripted run is never shown as agent behaviour; the cohort summary reports live and simulated separately.
import { attackerBadge, cohortSummary, modeSplit, launchPath, launchPaths, modeById, FLEET_MODES, loopDepthFromActions, compareSummary } from "../../../console/fleet-mode.js";

describe("attackerBadge: honesty on every tile", () => {
  it("labels droid as live and scripted as simulated", () => {
    expect(attackerBadge("droid")).toEqual({ kind: "live", text: "Live Droid" });
    expect(attackerBadge("scripted")).toEqual({ kind: "simulated", text: "Scripted (simulated)" });
  });
  it("never shows an unknown attacker as live", () => {
    expect(attackerBadge(undefined).kind).toBe("unknown");
    expect(attackerBadge("something-else").kind).toBe("unknown");
  });
});

describe("cohortSummary: live and simulated counted apart", () => {
  it("groups by attacker and never pools the rate", () => {
    const boxes = [
      { attacker: "droid", mirage: 0, block: 0 },
      { attacker: "droid", mirage: 1, block: 0 },
      { attacker: "scripted", mirage: 1, block: 0 },
      { attacker: "scripted", mirage: 0, block: 1 },
    ];
    const summary = cohortSummary(boxes);
    expect(summary).toHaveLength(2);
    const liveCohort = summary.find((c) => c.kind === "live")!;
    const simCohort = summary.find((c) => c.kind === "simulated")!;
    expect(liveCohort).toMatchObject({ agents: 2, crossed: 1 });
    expect(liveCohort.text).toContain("1 of 2 crossed scope");
    expect(simCohort).toMatchObject({ agents: 2, crossed: 2 });
    expect(simCohort.text).toContain("caught"); // scripted framed as caught, not chosen
  });
  it("orders live before simulated", () => {
    const summary = cohortSummary([{ attacker: "scripted", mirage: 0, block: 0 }, { attacker: "droid", mirage: 0, block: 0 }]);
    expect(summary.map((c) => c.kind)).toEqual(["live", "simulated"]);
  });
});

describe("modeSplit / launchPath / modes", () => {
  it("splits: live is all Droid, demo is n-1 Droid + 1 scripted", () => {
    expect(modeSplit("live", 10)).toEqual({ live: 10, simulated: 0 });
    expect(modeSplit("demo", 6)).toEqual({ live: 5, simulated: 1 });
    expect(modeSplit("demo", 1)).toEqual({ live: 0, simulated: 1 });
  });
  it("launchPath carries mode and n for live", () => {
    expect(launchPath("live", 1000)).toBe("/cage/fleet/start?mode=live&n=1000");
  });
  it("demo launches n-1 live agents plus one guaranteed-crossing scripted VM via the server mix form", () => {
    expect(launchPath("demo", 3)).toBe("/cage/fleet/start?real=eval-rerun,eval-rerun&rogue=billing-sync");
    expect(launchPath("demo", 1)).toBe("/cage/fleet/start?rogue=billing-sync");
    expect(launchPath("demo", 2, true)).toBe("/cage/fleet/start?real=eval-rerun&rogue=billing-sync&watcher=off");
  });
  it("demo launches the live agents first, then the crossing VM as its own fleet", () => {
    expect(launchPaths("demo", 25)).toEqual([`/cage/fleet/start?real=${Array(24).fill("eval-rerun").join(",")}`, "/cage/fleet/start?rogue=billing-sync&labelOffset=24"]);
    expect(launchPaths("demo", 2, true)).toEqual(["/cage/fleet/start?real=eval-rerun&watcher=off", "/cage/fleet/start?rogue=billing-sync&labelOffset=1&watcher=off"]);
    expect(launchPaths("demo", 1)).toEqual(["/cage/fleet/start?rogue=billing-sync"]);
    expect(launchPaths("live", 6)).toEqual(["/cage/fleet/start?mode=live&n=6"]);
  });
  it("exposes exactly live and demo", () => {
    expect(FLEET_MODES.map((m) => m.id)).toEqual(["live", "demo"]);
    expect(modeById("demo")?.name).toBe("Demo");
    expect(modeById("mixed")).toBeUndefined();
  });
});

describe("FISCUS task 4 helpers: watcher-off path, loop depth, contrast", () => {
  it("launchPath appends watcher=off only for the contrast run", () => {
    expect(launchPath("scripted", 6, false)).toBe("/cage/fleet/start?mode=scripted&n=6");
    expect(launchPath("scripted", 6, true)).toBe("/cage/fleet/start?mode=scripted&n=6&watcher=off");
  });
  it("loopDepthFromActions counts the most-repeated mirage command", () => {
    const a = (cmd: string, decision: string) => ({ cmd, decision });
    expect(loopDepthFromActions([a("GET x", "pass"), a("cat /opt", "mirage"), a("cat /opt", "mirage"), a("cat /opt", "mirage"), a("ls /etc", "mirage")])).toBe(3);
    expect(loopDepthFromActions([a("cat ok", "pass")])).toBe(0);
    expect(loopDepthFromActions([])).toBe(0);
  });
  it("compareSummary shows — until run.summary lands, and labels each side", () => {
    const c = compareSummary({ realOutOfScope: 0 }, { realOutOfScope: 9 });
    expect(c.on!.value).toBe("0");
    expect(c.off!.value).toBe("9");
    expect(c.off!.label).toContain("Without");
    const pending = compareSummary({ realOutOfScope: null }, null);
    expect(pending.on!.value).toBe("—");
    expect(pending.off).toBeNull();
  });
});
