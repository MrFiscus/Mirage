import { describe, expect, it } from "vitest";
// The console's pure fleet-mode helpers (Person A touched console/). The badge comes ONLY from session.attacker, so a
// scripted run is never shown as agent behaviour; the cohort summary reports live and simulated separately.
import { attackerBadge, cohortSummary, modeSplit, launchPath, modeById, FLEET_MODES } from "../../../console/fleet-mode.js";

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

describe("modeSplit / launchPath / modes mirror the server", () => {
  it("splits match server modeSplit", () => {
    expect(modeSplit("live", 10)).toEqual({ live: 10, simulated: 0 });
    expect(modeSplit("mixed", 9)).toEqual({ live: 5, simulated: 4 });
  });
  it("launchPath carries mode and n", () => {
    expect(launchPath("mixed", 1000)).toBe("/cage/fleet/start?mode=mixed&n=1000");
  });
  it("exposes exactly the three modes", () => {
    expect(FLEET_MODES.map((m) => m.id)).toEqual(["live", "mixed", "scripted"]);
    expect(modeById("scripted")?.name).toBe("Fully scripted");
    expect(modeById("bogus")).toBeUndefined();
  });
});
