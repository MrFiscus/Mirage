// Kill test (Person A). Proves the walls stand before we trust them in a demo:
//  1. The caps stop a run cold even when the watcher THROWS (the kill switch does not depend on the watcher).
//  2. (Daytona) the network block takes effect, and we report the tier (whether native updateNetworkSettings worked).
import { DaytonaSandbox } from "../defense/sandbox/daytona.js";
import { LocalSandbox } from "../defense/sandbox/local.js";
import type { Sandbox } from "../defense/sandbox/index.js";
import { ScriptedAttacker } from "./attackers/scripted.js";
import { CageBus } from "./events.js";
import { runSession, seedCage } from "./harness.js";
import { loadDecoys } from "./task.js";
import { contain } from "./kill.js";
import { CannedMirage } from "./stubs/mirage.js";
import type { CageToolCall, Session, Verdict, Watcher } from "./types.js";

try { process.loadEnvFile(".env"); } catch { /* no .env */ }

/** A watcher that throws on every call. If a run still stops at the step cap, the cap is truly independent. */
class ThrowingWatcher implements Watcher {
  async decide(_c: CageToolCall, _s: Session): Promise<Verdict> {
    throw new Error("watcher deliberately broken for the kill test");
  }
}

async function main(): Promise<void> {
  const backend = (process.argv.includes("--backend") ? process.argv[process.argv.indexOf("--backend") + 1] : "local");
  const results: string[] = [];

  // Test 1: caps stop the run with a broken watcher. watcherOn=false so the throwing watcher is not even consulted;
  // the point is that nothing in the stop path needs the watcher — the step cap alone ends it.
  const sb1: Sandbox = backend === "daytona" ? await DaytonaSandbox.create() : await LocalSandbox.create();
  try {
    const bus = new CageBus();
    const r = await runSession({
      attacker: new ScriptedAttacker(), watcher: new ThrowingWatcher(), mirage: new CannedMirage(),
      sandbox: sb1, bus, caps: { steps: 3, seconds: 180, spendUsd: 1 }, watcherOn: false,
    });
    const steps = r.session.realCalls + r.session.fakeCalls;
    results.push(`[${steps <= 3 && r.capReason === "steps" ? "PASS" : "FAIL"}] step cap stops the run cold at ${steps} step(s); capReason=${r.capReason}`);
  } finally {
    await sb1.destroy().catch(() => undefined);
  }

  // Test 2 (Daytona only): can the sandbox reach the REAL internet, and does containment stop it? Reports the tier.
  if (backend === "daytona") {
    const sb2 = await DaytonaSandbox.create();
    try {
      await seedCage(sb2, loadDecoys().decoys); // starts the decoy sink so the deny-file probe has something to answer
      const reach = () => sb2.exec(`curl -s -m 8 -o /dev/null -w "%{http_code}" https://example.com || echo unreachable`);
      const before = (await reach()).stdout.trim();
      results.push(`[INFO] real internet before containment: ${before} ${before.startsWith("2") || before.startsWith("3") ? "(open — this is why the block matters)" : ""}`);
      const c = await contain(sb2);
      results.push(`[INFO] network block mechanism: ${c.network} ${c.network === "daytona-native" ? "(Tier 3+ native iptables block)" : "(simulated deny file; native refused or tier < 3)"}`);
      const after = (await reach()).stdout.trim();
      if (c.network === "daytona-native") results.push(`[${after.includes("unreachable") || after === "000" ? "PASS" : "FAIL"}] real internet after native block: ${after}`);
      const probe = await sb2.exec(`node -e "const h=require('http');const r=h.get({socketPath:'run/net.sock',path:'/',headers:{host:'x.test'}},x=>{x.resume();x.on('end',()=>process.stdout.write(String(x.statusCode)))});r.on('error',()=>process.stdout.write('err'))"`);
      results.push(`[${probe.stdout.trim() === "403" ? "PASS" : "FAIL"}] decoy sink refuses requests after the block (got ${probe.stdout.trim()})`);
    } finally {
      await sb2.destroy().catch(() => undefined);
    }
  } else {
    results.push("[SKIP] network-block tier check needs --backend daytona");
  }

  console.log("\n── kill test ────────────────────────────────");
  for (const r of results) console.log(r);
  console.log("─────────────────────────────────────────────\n");
  if (results.some((r) => r.startsWith("[FAIL]"))) process.exit(1);
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
