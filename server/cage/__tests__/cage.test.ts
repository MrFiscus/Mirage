import { describe, expect, it } from "vitest";
import type { ExecResult, Sandbox } from "../../defense/sandbox/types.js";
import { ScriptedAttacker } from "../attackers/scripted.js";
import { CapGuard } from "../caps.js";
import { CageBus } from "../events.js";
import { runSession } from "../harness.js";
import { CannedMirage } from "../stubs/mirage.js";
import { PassWatcher, RulesWatcher } from "../stubs/watcher.js";
import type { CageToolCall, MirageEvent, Session, Verdict, Watcher } from "../types.js";

/** Fast in-memory sandbox: no real processes. Records every exec so tests can assert what reached the real env. */
class FakeSandbox implements Sandbox {
  readonly id = "fake";
  execCalls: string[] = [];
  firstExecSeq = -1;
  constructor(private seq: { n: number }) {}
  async exec(command: string): Promise<ExecResult> {
    if (this.firstExecSeq < 0) this.firstExecSeq = this.seq.n++;
    this.execCalls.push(command);
    return { code: 0, stdout: "ok", stderr: "" };
  }
  async runScript(): Promise<ExecResult> { return { code: 0, stdout: "", stderr: "" }; }
  async readFile(path: string): Promise<string> {
    if (this.firstExecSeq < 0) this.firstExecSeq = this.seq.n++;
    this.execCalls.push(`readFile ${path}`);
    return "fake file";
  }
  async clone(): Promise<Sandbox> { return this; }
  async destroy(): Promise<void> {}
}

class ThrowingWatcher implements Watcher {
  async decide(_c: CageToolCall, _s: Session): Promise<Verdict> { throw new Error("broken watcher"); }
}

function setup() {
  const seq = { n: 0 };
  const sb = new FakeSandbox(seq);
  const events: MirageEvent[] = [];
  const bus = new CageBus();
  let firstCallSeq = -1;
  bus.subscribe((e) => { events.push(e); if (e.type === "tool.call" && firstCallSeq < 0) firstCallSeq = seq.n++; });
  return { sb, bus, events, getFirstCallSeq: () => firstCallSeq };
}

describe("cage harness (Person A)", () => {
  it("records each call on the host log before it runs in the sandbox", async () => {
    const { sb, bus, events, getFirstCallSeq } = setup();
    await runSession({ attacker: new ScriptedAttacker(), watcher: new PassWatcher(), mirage: new CannedMirage(), sandbox: sb, bus, watcherOn: false, skipSeed: true });
    expect(events.filter((e) => e.type === "tool.call").length).toBe(13);
    // the first tool.call event was emitted before the first sandbox exec happened
    expect(getFirstCallSeq()).toBeGreaterThanOrEqual(0);
    expect(getFirstCallSeq()).toBeLessThan(sb.firstExecSeq);
  });

  it("stops at exactly the step cap even when the watcher throws (kill switch is independent)", async () => {
    const { sb, bus } = setup();
    const r = await runSession({
      attacker: new ScriptedAttacker(), watcher: new ThrowingWatcher(), mirage: new CannedMirage(),
      sandbox: sb, bus, watcherOn: false, skipSeed: true, caps: { steps: 5, seconds: 180, spendUsd: 1 },
    });
    expect(r.session.realCalls + r.session.fakeCalls).toBe(5);
    expect(r.capReason).toBe("steps");
  });

  it("a block verdict never reaches the sandbox, and a mirage verdict never touches it", async () => {
    const { sb, bus } = setup();
    await runSession({ attacker: new ScriptedAttacker(), watcher: new RulesWatcher(), mirage: new CannedMirage(), sandbox: sb, bus, skipSeed: true });
    const joined = sb.execCalls.join("\n");
    expect(joined).not.toContain("drop.exfil-sim.test"); // the blocked decoy upload
    expect(joined).not.toContain("secrets/"); // mirage reads never hit the real env
    expect(joined).not.toContain("169.254.169.254"); // mirage metadata probe never ran
  });

  it("with the watcher on there are zero real out-of-scope executions; with it off there are several", async () => {
    const on = setup();
    const ron = await runSession({ attacker: new ScriptedAttacker(), watcher: new RulesWatcher(), mirage: new CannedMirage(), sandbox: on.sb, bus: on.bus, skipSeed: true });
    expect(ron.realOutOfScope).toBe(0);
    expect(ron.session.triggered).toBe(true);

    const off = setup();
    const roff = await runSession({ attacker: new ScriptedAttacker(), watcher: new PassWatcher(), mirage: new CannedMirage(), sandbox: off.sb, bus: off.bus, watcherOn: false, skipSeed: true });
    expect(roff.realOutOfScope).toBeGreaterThan(0);
  });

  it("CapGuard trips on seconds without any watcher involvement", async () => {
    let tripped: string | undefined;
    const g = new CapGuard({ steps: 99, seconds: 0, spendUsd: 1 }, (r) => (tripped = r));
    expect(g.checkBeforeStep(1)).toBe("seconds");
    expect(tripped).toBe("seconds");
    g.dispose();
  });
});
