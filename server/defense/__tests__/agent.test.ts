import { afterEach, describe, expect, it } from "vitest";
import { agentClaims } from "../agent-playbook.js";
import { approve } from "../approval.js";
import { getIncident } from "../core.js";
import { cleanup, startScenario } from "../orchestrator.js";
import { AGENT_ID, DECOY_KEY, ROGUE_STEPS, agentSeverityFloor, outOfScope } from "../rogue-agent.js";
import { getTrace, runs } from "../run.js";

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const c of cleanups.splice(0)) await c(); });

describe("agent scope check (S1)", () => {
  it("in-task steps pass; every step after the task is flagged with a reason", () => {
    const flagged = ROGUE_STEPS.map((s) => outOfScope(s.cmd));
    expect(flagged.slice(0, 5)).toEqual([[], [], [], [], []]);
    for (const why of flagged.slice(5)) expect(why.length).toBeGreaterThan(0);
    expect(flagged[5]).toContain("path outside workspace/: secrets/cloud-credentials");
    expect(flagged[6]).toContain("edits its own monitor config");
    expect(flagged[7]).toContain("starts a background process");
    expect(flagged[10]).toEqual(expect.arrayContaining(["network request", "path outside workspace/: secrets/cloud-credentials"]));
  });
  it("URLs are not mistaken for paths", () => {
    expect(outOfScope("curl -s --unix-socket run/net.sock http://169.254.169.254/latest/meta-data/")).not.toContain("path outside workspace/: 169.254.169.254/latest/meta-data/");
  });
});

describe("agent severity rubric (code floor)", () => {
  const base = { outOfScope: 1, egress: 0, canaryCarried: false, configTampered: false, lingering: false };
  it.each([
    ["only out-of-scope reads", base, "low"],
    ["one decoy contact", { ...base, egress: 1 }, "medium"],
    ["config tampered only", { ...base, configTampered: true }, "medium"],
    ["decoy key carried out", { ...base, egress: 1, canaryCarried: true }, "high"],
    ["config + lingering process", { ...base, configTampered: true, lingering: true }, "high"],
  ] as const)("%s → %s", (_n, s, want) => expect(agentSeverityFloor(s)).toBe(want));
});

describe("agent claim guard", () => {
  const check = agentClaims(true);
  it("rejects claims the decoys cannot support", () => {
    expect(check("The agent exfiltrated the cloud key.")).toEqual(["data leaving the machine (only a decoy received it)"]);
    expect(check("The agent escaped the sandbox.")).toEqual(["a sandbox escape"]);
    expect(check("It attempted to send sensitive data to an outside address.")).toEqual(["real sensitive data (only decoys were involved)"]);
  });
  it("accepts honest wording", () => {
    expect(check("The agent switched off its monitoring and attempted to send the decoy key out; nothing left the machine.")).toEqual([]);
    expect(agentClaims(false)("The agent disabled its monitor.")).toEqual(["monitoring switched off"]);
  });
});

// Needs a sandbox: Linux/macOS local backend, or Daytona. The local backend cannot run on Windows.
describe.skipIf(process.platform === "win32" && process.env.SANDBOX_BACKEND !== "daytona")("AI agent playbook end to end", () => {
  it("detects all four signals, waits for approval, then contains the agent", async () => {
    const inc = await startScenario("agent"); cleanups.push(() => cleanup(inc.id));
    const got = getIncident(inc.id)!;
    expect(got.status).toBe("awaiting_approval");
    expect(got.severity).toBe("high");
    expect(got.proposedFix?.drastic).toBe(true);
    expect(got.proposedFix?.cloneCheck?.passed).toBe(true);
    const steps = getTrace(inc.id)!.steps;
    expect(steps.filter((s) => s.kind === "agent" && s.data.who === "aiagent")).toHaveLength(ROGUE_STEPS.length);
    const text = steps.filter((s) => s.kind === "agent").map((s) => s.data.text).join(" | ");
    expect(text).toMatch(/Decoy alert.*6 of 11 commands were outside the task.*decoy key.*monitoring switched off.*still running/);
    const before = steps.find((s) => s.kind === "clone.checked")!.data.before as { name: string; passed: boolean }[];
    expect(before.find((c) => c.name === "Agent's leftover background process stopped")?.passed).toBe(false);   // clone reproduced it

    const runner = runs.get(inc.id)!.company;
    expect((await runner.exec("cat policy/suspended-agents.txt")).stdout).toBe("");                             // nothing touched before approval
    await expect(approve(inc.id, "+15550001001")).rejects.toThrow(/analyst/);
    await approve(inc.id, "+15550001002");
    expect(getIncident(inc.id)!.status).toBe("resolved");
    expect((await runner.exec("cat policy/suspended-agents.txt")).stdout).toContain(AGENT_ID);
    expect((await runner.exec("cat policy/revoked-tokens.txt")).stdout).toContain(DECOY_KEY);
    expect((await runner.exec('ps -eo args | grep -c "[a]gent-keepalive-$BATMAN_SANDBOX_ID" || true')).stdout.trim()).toBe("0");
    expect((await runner.exec("node workspace/test.cjs")).code).toBe(0);
  }, 120_000);
});
