// Demo smoke check (Person A). Run before every rehearsal: `npm run demo:check`. Nothing external is started (no
// Daytona, no Droid, no provider calls beyond what the watcher's LLM layer may do on ambiguous calls — set
// WATCHER_LLM=off to make it fully offline). Exits nonzero on the first failed check.
//  1. One in-process scripted session with the REAL watcher and REAL mirage: realOutOfScope must be 0, exactly one
//     run.summary must be emitted, the forensic file must exist and its first line must be the session.started
//     record followed by a tool.call written before any verdict.
//  2. The same with the watcher OFF: realOutOfScope must be > 0 (the contrast run is real).
//  3. A local server: POST /cage/fleet/start?mode=scripted&n=2 returns 202 and the run ends with two run.summary
//     events; GET /cage/runs/:session serves the forensic log of one of them.
import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { ACME_SCRIPT, ScriptedAttacker } from "./attackers/scripted.js";
import { CageBus } from "./events.js";
import { runSession } from "./harness.js";
import { CAGE_RUNS_DIR } from "./runs.js";
import type { MirageEvent } from "./types.js";
import { makeRealMirage, NullSandbox, realWatcher } from "./wire.js";

try { process.loadEnvFile(".env"); } catch { /* fine */ }

let failed = 0;
const check = (ok: boolean, what: string, detail = "") => {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${what}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
};

async function inProcess(watcherOn: boolean) {
  const path = `${CAGE_RUNS_DIR}/demo-check-${watcherOn ? "on" : "off"}-${Date.now()}.jsonl`;
  const bus = new CageBus(path);
  const events: MirageEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const r = await runSession({ attacker: new ScriptedAttacker(ACME_SCRIPT), watcher: realWatcher, mirage: makeRealMirage(null), sandbox: new NullSandbox(), bus, watcherOn, honestEnv: "acme" });
  return { r, events, path };
}

async function main(): Promise<void> {
  // 1. watcher on
  const on = await inProcess(true);
  check(on.r.realOutOfScope === 0, "watcher ON: zero real out-of-scope executions", `real=${on.r.session.realCalls} fake=${on.r.session.fakeCalls} blocked=${on.r.summary.blocked}`);
  check(on.r.session.triggered && on.r.session.fakeCalls > 0, "watcher ON: the run crossed the boundary and was routed to the mirage", `trigger step ${on.r.session.triggerStep}: ${on.r.session.triggerReason}`);
  check(on.events.filter((e) => e.type === "run.summary").length === 1, "exactly one run.summary emitted");
  check(on.r.summary.forensicPath === on.path && existsSync(on.path), "forensic file exists at summary.forensicPath", on.path);
  const lines = readFileSync(on.path, "utf8").trim().split("\n").map((l) => JSON.parse(l) as { type: string });
  check(lines[0]?.type === "session.started" && lines[1]?.type === "tool.call" && lines[2]?.type === "watcher.verdict", "log order: session.started, tool.call BEFORE its verdict", lines.slice(0, 3).map((l) => l.type).join(" → "));
  check(on.r.summary.networkIsolation === "n/a" && on.r.containment?.network === "n/a (in-process env)", "in-process env reports containment honestly as n/a", `${on.r.containment?.network}`);

  // 2. watcher off
  const off = await inProcess(false);
  check(off.r.realOutOfScope > 0, "watcher OFF: real out-of-scope executions happen (contrast run is real)", `realOOS=${off.r.realOutOfScope}`);
  for (const p of [on.path, off.path]) rmSync(p, { force: true });

  // 3. server fleet
  const port = 8793 + Math.floor(Math.random() * 100);
  const server = spawn(process.execPath, ["--import", "tsx", "server/index.ts"], { env: { ...process.env, PORT: String(port), PHOTON_MODE: "mock", VOICE_MODE: "mock", CAGE_MIRAGE_LATENCY_MS: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  server.stdout.on("data", (d) => (out += d));
  server.stderr.on("data", (d) => (out += d));
  try {
    const base = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + 30_000;
    let up = false;
    while (Date.now() < deadline && !up) {
      try { up = (await fetch(`${base}/api/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 300)); }
    }
    check(up, "server starts", up ? base : out.slice(-400));
    if (!up) return;
    const ws = await import("ws");
    const summaries: Array<{ session: string; realOutOfScope: number }> = [];
    const sock = new ws.WebSocket(`${base.replace("http", "ws")}/events`);
    sock.on("message", (m) => { const e = JSON.parse(String(m)) as { type: string; summary?: { session: string; realOutOfScope: number } }; if (e.type === "run.summary" && e.summary) summaries.push(e.summary); });
    await new Promise<void>((resolve) => sock.once("open", () => resolve()));
    const res = await fetch(`${base}/cage/fleet/start?mode=scripted&n=2`, { method: "POST" });
    check(res.status === 202, "POST /cage/fleet/start?mode=scripted&n=2 returns 202", String(res.status));
    const until = Date.now() + 60_000;
    while (Date.now() < until && summaries.length < 2) await new Promise((r) => setTimeout(r, 250));
    check(summaries.length === 2, "fleet run ends with two run.summary events", `${summaries.length}`);
    check(summaries.every((s) => s.realOutOfScope === 0), "both fleet sessions: zero real out-of-scope");
    if (summaries[0]) {
      const dl = await fetch(`${base}/cage/runs/${summaries[0].session}`);
      const body = await dl.text();
      check(dl.status === 200 && body.startsWith('{"type":"session.started"'), "GET /cage/runs/:session serves the forensic JSONL", `${dl.status}, ${body.split("\n").length} lines`);
    }
    const list = await (await fetch(`${base}/cage/runs`)).json() as unknown[];
    check(Array.isArray(list) && list.length >= 2, "GET /cage/runs lists the fleet's sessions", `${(list as unknown[]).length}`);
    sock.close();
  } finally {
    server.kill();
  }
}

main().then(() => {
  console.log(failed ? `\n${failed} check(s) FAILED` : "\nall demo checks passed");
  process.exit(failed ? 1 : 0);
}).catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
