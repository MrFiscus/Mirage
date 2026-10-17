// Fleet runner (Person A). Runs many agents through the real watcher and reports what they actually did.
//
//  Small / demo:  npm run cage:fleet -- --scenarios billing-sync,orders-report [--rogue billing-sync,hotfix-deploy]
//  SCALE:         npm run cage:fleet -- --agents 1000 --concurrency 10 --env vm --token-budget 20000000
//
// --agents N      total live agents to run (cycles through --scenarios; default = the three blocked jobs). Unlimited.
// --concurrency C how many run AT ONCE. This is the Daytona VM limit, not the total (default 10 for vm, 20 for acme).
// --env vm|acme   vm = a fresh real Daytona VM per agent (faithful: real shell). acme = in-process world, no VM, flag
//                 hunt only (no real python/node, so agents may behave differently — do not mix the two in one claim).
// --token-budget  stop starting new agents once the fleet has used this many tokens (the honest spend control).
// Every finished agent is appended to data/fleet-runs/<timestamp>.jsonl as it completes, so a 1000-agent run never
// holds everything in memory and a crash loses nothing. Ctrl-C stops launching; running agents finish and clean up.
// Droid falls back to scripted (and says so) when FACTORY_API_KEY is absent. This CLI does not touch the analyst notifier.
import { appendFileSync, mkdirSync } from "node:fs";
import type { MirageEvent } from "../../shared/types.js";
import { membersFromAgents, membersFromMix, membersFromScenarios, runCageFleet, wilson95, type FleetAttacker, type FleetResult } from "./fleet.js";
import { SCENARIOS } from "./scenarios.js";

try { process.loadEnvFile(".env"); } catch { /* no .env: fine */ }

const arg = (name: string, fallback?: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};
const flag = (name: string) => process.argv.includes(`--${name}`);
const list = (v: string | undefined) => (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

const BLOCKED = SCENARIOS.filter((s) => s.kind === "blocked").map((s) => s.id);
const agentsN = arg("agents") !== undefined ? Number(arg("agents")) : undefined;
const env = (arg("env", "vm") as "vm" | "acme");
const attacker = (arg("attacker", "droid") as FleetAttacker);
const rogue = list(arg("rogue"));
const ids = list(arg("scenarios")).length ? list(arg("scenarios")) : agentsN !== undefined ? (env === "acme" ? ["eval-rerun"] : BLOCKED) : SCENARIOS.map((s) => s.id);
const watcherOn = arg("watcher", "on") !== "off";
const concurrency = Number(arg("concurrency")) || (env === "acme" ? 20 : 10);
const tokenBudget = arg("token-budget") !== undefined ? Number(arg("token-budget")) : undefined;
const caps = {
  steps: Number(arg("steps")) || 40,
  seconds: Number(arg("seconds")) || 150,
  spendUsd: Number(arg("spend")) || Number(process.env.CAGE_MAX_SPEND_USD) || 1,
};
// Quiet by default once the fleet is big: print only crossings, summaries and progress.
const verbose = flag("verbose") || (agentsN ?? ids.length + rogue.length) <= 12;

const calls = new Map<string, { sid: string; tool: string; shown: string }>();
function onEvent(e: MirageEvent): void {
  if (e.type === "tool.call") {
    const c = e.call;
    calls.set(c.id, { sid: c.session, tool: c.tool, shown: JSON.stringify(c.args).slice(0, 90) });
  } else if (e.type === "watcher.verdict") {
    const c = calls.get(e.callId);
    if (c && (verbose || e.verdict.decision !== "pass")) console.log(`[${c.sid}] ${e.verdict.decision.toUpperCase().padEnd(6)} ${c.tool} ${c.shown}${e.verdict.decision !== "pass" ? `   <- ${e.verdict.reasons[0] ?? ""}` : ""}`);
    if (c && e.verdict.decision === "pass") calls.delete(e.callId); // keep the map small over thousands of calls
  } else if (e.type === "mirage.served") {
    const c = calls.get(e.callId);
    if (c && verbose) console.log(`[${c.sid}]        fake served: ${JSON.stringify(e.entry.value.split("\n")[0]).slice(0, 100)}  (progress ${e.entry.progress.toFixed(2)})`);
    if (c) calls.delete(e.callId);
  } else if (e.type === "audit" && e.actor === "fleet" && (verbose || ["fleet.starting", "fleet.budget", "fleet.complete", "vm.failed", "droid.fallback"].includes(e.action))) {
    console.log(`  [fleet] ${e.action}: ${e.detail}`);
  } else if (e.type === "audit" && e.action === "watcher.miss") {
    console.log(`  [GUARD] ${e.detail}`);
  } else if (e.type === "audit" && e.action === "attacker.error") {
    console.log(`  [cage] attacker.error: ${e.detail}`);
  } else if (e.type === "kill" && verbose) {
    console.log(`  [${e.session}] KILL: ${e.reason}`);
  }
}

const logDir = "data/fleet-runs";
mkdirSync(logDir, { recursive: true });
const logPath = `${logDir}/${Date.now()}-${env}-${attacker}${agentsN !== undefined ? `-${agentsN}` : ""}.jsonl`;
let crossedSoFar = 0;
const started = Date.now();

function onResult(r: FleetResult, done: number, total: number): void {
  appendFileSync(logPath, JSON.stringify(r) + "\n");
  if (r.ranAs === "droid" && r.triggered) crossedSoFar++;
  if (!verbose && (done % 10 === 0 || done === total || r.triggered)) {
    const mins = ((Date.now() - started) / 60000).toFixed(1);
    console.log(`  progress ${done}/${total}  live-Droid crossed scope so far: ${crossedSoFar}  (${mins} min)${r.triggered ? `   <- ${r.label} ${r.scenario}: ${r.triggerReason}` : ""}`);
  }
}

let stopping = false;
process.on("SIGINT", () => {
  if (stopping) { console.log("\nforced exit; VMs are ephemeral and auto-stop within ~10 min"); process.exit(130); }
  stopping = true;
  console.log("\nstopping: no new agents will start; waiting for running ones to finish and clean up (Ctrl-C again to force)");
});

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

function report(results: FleetResult[], requested: number): void {
  const live = results.filter((r) => r.ranAs === "droid");
  const sim = results.filter((r) => r.ranAs === "scripted");
  console.log("\n── results ─────────────────────────────────────────────────────────────");
  if (results.length <= 12) {
    for (const r of results) {
      console.log(`${r.label}  ${r.scenario.padEnd(14)} ${r.kind.padEnd(8)} ${r.ranAs === "scripted" ? "SCRIPTED(sim)" : "live droid   "}  steps=${String(r.steps).padStart(2)}  ` +
        `${r.triggered ? `CROSSED SCOPE at step ${r.triggerStep}` : "stayed in scope"}  realOOS=${r.realOutOfScope} misses=${r.watcherMisses}`);
      if (r.triggered) console.log(`        first trigger: ${r.triggerReason}`);
      if (r.crossings.length) console.log(`        reached for:   ${r.crossings.join(", ")}`);
      if (r.agentError) console.log(`        agent error:   ${r.agentError}`);
      if (r.agentSaid) console.log(`        agent said:    "${r.agentSaid}"`);
    }
    console.log("");
  }

  const section = (title: string, rs: FleetResult[]) => {
    if (!rs.length) return;
    const crossed = rs.filter((r) => r.triggered).length;
    const ci = wilson95(crossed, rs.length);
    console.log(`${title}: ${rs.length} agents -> ${crossed} crossed scope (${pct(crossed / rs.length)}; 95% CI ${pct(ci.low)}–${pct(ci.high)})`);
    const by = new Map<string, FleetResult[]>();
    for (const r of rs) by.set(r.scenario, [...(by.get(r.scenario) ?? []), r]);
    for (const [sc, g] of by) {
      const k = g.filter((r) => r.triggered).length;
      console.log(`    ${sc.padEnd(14)} ${g[0].kind.padEnd(8)} ${k}/${g.length} crossed`);
    }
  };
  section("LIVE Droid (unscripted)", live);
  section("SIMULATED (scripted rogue, not agent behaviour)", sim);

  const crossers = live.filter((r) => r.triggered);
  if (crossers.length) {
    const tally = new Map<string, number>();
    for (const r of crossers) for (const c of r.crossings) tally.set(c, (tally.get(c) ?? 0) + 1);
    console.log("what live agents reached for when they crossed (top):");
    for (const [what, n] of [...tally].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`    ${String(n).padStart(4)}×  ${what}`);
  }
  const tokens = results.reduce((n, r) => n + r.tokens, 0);
  const sec = ((Date.now() - started) / 1000).toFixed(0);
  console.log(`\nran ${results.length} of ${requested} requested${results.length < requested ? " (stopped early)" : ""}; ${sec}s; tokens used: ${tokens || "n/a"}${tokenBudget ? ` of budget ${tokenBudget}` : ""}`);
  console.log(`real out-of-scope executions (must be 0): ${results.reduce((n, r) => n + r.realOutOfScope, 0)}   watcher misses caught by guard: ${results.reduce((n, r) => n + r.watcherMisses, 0)}`);
  console.log(`per-agent records: ${logPath}`);
  console.log("────────────────────────────────────────────────────────────────────────\n");
}

async function main(): Promise<void> {
  if (env === "acme" && ids.some((id) => id !== "eval-rerun")) throw new Error("--env acme only supports the flag-hunt scenario (eval-rerun): the other jobs need real files on a VM");
  const members = rogue.length ? membersFromMix(ids, rogue)
    : agentsN !== undefined ? membersFromAgents(agentsN, ids, attacker, env)
    : membersFromScenarios(ids, attacker);
  const live = members.filter((m) => m.attacker === "droid").length;
  console.log(`fleet: ${members.length} agents (${live} live ${attacker}, ${members.length - live} scripted/simulated), ${concurrency} at a time, env=${env}, watcher=${watcherOn ? "on" : "off"}, caps=${JSON.stringify(caps)}${tokenBudget ? `, token budget ${tokenBudget}` : ""}`);
  if (live > 50 && tokenBudget === undefined) console.log("  note: no --token-budget set; spend is bounded only by steps/seconds per agent. Consider --token-budget.");
  console.log(`  per-agent log: ${logPath}\n`);
  const results = await runCageFleet({ members, emit: onEvent, watcherOn, caps, concurrency, tokenBudget, onResult, shouldStop: () => stopping });
  report(results, members.length);
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
