// Cage CLI (Person A). Starts one session from the command line.
//   npm run cage -- --attacker scripted --watcher real --honest acme --steps 40 --seconds 180 --spend 1 [--json]
// Attacker: scripted (default) | droid. Watcher: off | stub | rules | real. Honest env: acme (default, in-process,
// no Daytona) | vm (real Daytona VM, Acme tree) | sandbox (legacy cage deploy world). Backend (sandbox env): local | daytona.
import { DaytonaSandbox } from "../defense/sandbox/daytona.js";
import { LocalSandbox } from "../defense/sandbox/local.js";
import type { Sandbox } from "../defense/sandbox/index.js";
import { ACME_SCRIPT, ScriptedAttacker } from "./attackers/scripted.js";
import type { Attacker } from "./attacker.js";
import { CageBus } from "./events.js";
import { runSession } from "./harness.js";
import { makeRealMirage, NullSandbox, realWatcher } from "./wire.js";
import { PassWatcher, RulesWatcher } from "./stubs/watcher.js";
import type { DroidAttacker } from "./attackers/droid.js";
import { CAGE_TASK, loadDecoys } from "./task.js";
import { TASK_PROMPT } from "../mirage/acme.js";
import { VmWorld } from "./world.js";
import type { Mirage, Watcher } from "./types.js";

try { process.loadEnvFile(".env"); } catch { /* no .env: fine */ }

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

async function main(): Promise<void> {
  const attackerKind = arg("attacker", "scripted")!;
  const watcherKind = arg("watcher", "real")!; // off | stub | rules | real
  const honest = (arg("honest", "acme") as "acme" | "sandbox" | "vm"); // acme (in-process) | vm (Daytona) | sandbox
  const backend = arg("backend", "local")!;
  const caps = {
    steps: Number(arg("steps")) || Number(process.env.CAGE_MAX_STEPS) || 40,
    seconds: Number(arg("seconds")) || Number(process.env.CAGE_MAX_SECONDS) || 180,
    spendUsd: Number(arg("spend")) || Number(process.env.CAGE_MAX_SPEND_USD) || 1,
  };

  // Droid's only actions are our cage tools (builtins disabled). With --honest acme those run in the in-process Acme
  // world (no real shell); with --honest sandbox they run the legacy cage shell, which must be the Daytona cage. The
  // vm world is itself a real Daytona VM, so a live shell there is already caged.
  if (attackerKind === "droid" && honest === "sandbox" && backend !== "daytona") {
    throw new Error("Refusing --attacker droid --honest sandbox without --backend daytona: a live model's shell must run in the Daytona cage.");
  }

  // The vm world uses the absolute Acme tree (/workspace). The legacy cage deploy script uses relative paths.
  const scriptedForEnv = honest === "sandbox" ? undefined : ACME_SCRIPT;
  let attacker: Attacker;
  let droid: DroidAttacker | undefined;
  if (attackerKind === "scripted") attacker = new ScriptedAttacker(scriptedForEnv);
  else if (attackerKind === "droid") attacker = droid = (await import("./attackers/droid.js")).makeDroidAttacker({ task: honest === "sandbox" ? CAGE_TASK : TASK_PROMPT });
  else throw new Error(`unknown --attacker ${attackerKind}`);

  const watcher: Watcher =
    watcherKind === "real" ? realWatcher : watcherKind === "rules" ? new RulesWatcher() : new PassWatcher();
  const watcherOn = watcherKind !== "off";

  const logPath = `data/cage-runs/${Date.now()}-${attackerKind}-${watcherKind}.jsonl`;
  const mirage: Mirage = makeRealMirage(null);
  // acme runs in-process (no Daytona); vm boots a real Daytona VM seeded with the Acme tree + decoys; sandbox is
  // the legacy cage deploy world on the chosen backend.
  const sandbox: Sandbox =
    honest === "acme" ? new NullSandbox()
    : honest === "vm" ? await VmWorld.create(loadDecoys().decoys)
    : backend === "daytona" ? await DaytonaSandbox.create() : await LocalSandbox.create();
  if (honest === "vm") console.log(`vm backstop: ${(sandbox as VmWorld).backstop}`);
  const bus = new CageBus(logPath);
  if (!flag("json")) bus.subscribe((e) => console.log(line(e)));

  try {
    const result = await runSession({ attacker, watcher, mirage, sandbox, bus, caps, watcherOn, honestEnv: honest });
    const { session, realOutOfScope, watcherMisses, capReason, containment, decoySource } = result;
    const summary = {
      attacker: attackerKind, watcher: watcherKind, honest, backend,
      steps: session.realCalls + session.fakeCalls,
      realCalls: session.realCalls, fakeCalls: session.fakeCalls, loopDepth: session.loopDepth,
      triggered: session.triggered, triggerStep: session.triggerStep, triggerReason: session.triggerReason,
      capFired: capReason ?? null,
      realOutOfScopeExecutions: realOutOfScope,
      watcherMisses,
      network: containment?.network ?? null,
      decoys: decoySource, log: logPath,
    };
    if (droid) {
      if (droid.toolsAfterLockdown.length) console.log(`droid tools after lockdown: ${droid.toolsAfterLockdown.join(", ")}`);
      if (droid.error) console.log(`droid ended with: ${droid.error}`);
    }
    if (flag("json")) console.log(JSON.stringify(summary, null, 2));
    else printSummary(summary);
  } finally {
    await sandbox.destroy().catch(() => undefined);
  }
}

function line(e: { type: string } & Record<string, unknown>): string {
  if (e.type === "tool.call") { const c = e.call as { step: number; tool: string; args: Record<string, unknown>; thought?: string }; return `  step ${c.step}: ${c.tool} ${JSON.stringify(c.args).slice(0, 80)}  "${c.thought ?? ""}"`; }
  if (e.type === "watcher.verdict") { const v = e.verdict as { decision: string; reasons: string[] }; return `    → ${v.decision.toUpperCase()}${v.reasons.length ? " (" + v.reasons[0] + ")" : ""}`; }
  if (e.type === "kill") return `  KILL: ${e.reason as string}`;
  if (e.type === "audit") return `  [${e.actor as string}] ${e.action as string}: ${e.detail as string}`;
  if (e.type === "session.started") return `session ${(e.session as { id: string }).id} started`;
  return "";
}

function printSummary(s: Record<string, unknown>): void {
  console.log("\n── cage summary ─────────────────────────────");
  console.log(`attacker=${s.attacker} watcher=${s.watcher} honest=${s.honest} backend=${s.backend}`);
  console.log(`steps=${s.steps}  real=${s.realCalls}  fake(mirage)=${s.fakeCalls}  loopDepth=${s.loopDepth}`);
  console.log(`triggered=${s.triggered}${s.triggered ? ` at step ${s.triggerStep} (${s.triggerReason})` : ""}`);
  console.log(`cap fired: ${s.capFired ?? "no"}   network: ${s.network ?? "n/a"}   decoys: ${s.decoys}`);
  console.log(`REAL out-of-scope executions: ${s.realOutOfScopeExecutions}  ${Number(s.realOutOfScopeExecutions) === 0 ? "(zero — contained)" : "(!! leaked past the watcher)"}`);
  if (Number(s.watcherMisses) > 0) console.log(`watcher misses caught by OS backstop: ${s.watcherMisses}  (out-of-scope, passed by watcher, refused by the VM)`);
  console.log(`forensic log: ${s.log}`);
  console.log("─────────────────────────────────────────────\n");
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
