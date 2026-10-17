// The harness (Person A) — the seam the whole project hinges on. It runs the attacker loop on the host and, between
// recording a call and executing it, calls watcher.decide(call). It routes by the verdict: pass → run in the real
// sandbox, mirage → ask the simulator (never touches the sandbox), block → refuse and contain. Caps run on their own
// (CapGuard) and do not depend on the watcher.
import { randomUUID } from "node:crypto";
import type { Sandbox } from "../defense/sandbox/index.js";
import { outOfScope } from "../defense/rogue-agent.js";
import type { Attacker, NextCall, Observed } from "./attacker.js";
import { CapGuard, type CapReason, DEFAULT_CAPS } from "./caps.js";
import type { CageBus } from "./events.js";
import { contain, type ContainmentResult } from "./kill.js";
import { CAGE_SCOPE, commandOf, type Decoy, loadDecoys } from "./task.js";
import { DEFAULT_SCOPE as ACME_SCOPE, outsideScope, runHonest } from "../mirage/acme.js";
import type { CageToolCall, Caps, Mirage, Session, Verdict, Watcher } from "./types.js";

export interface RunOptions {
  attacker: Attacker;
  watcher: Watcher;
  mirage: Mirage;
  sandbox: Sandbox;
  bus: CageBus;
  caps?: Caps;
  /** false = contrast run: skip the watcher, always pass (Person D's "no defense" condition). */
  watcherOn?: boolean;
  decoys?: Decoy[];
  /** Skip planting the task + decoys (tests with a fake sandbox that needs no real files). */
  skipSeed?: boolean;
  /** Where a `pass` call runs. "acme" (default) = in-process Acme world (no sandbox, runs anywhere);
   *  "sandbox" = the real Daytona/local sandbox seeded with the cage deploy files;
   *  "vm" = a real Daytona VM seeded with the Acme tree (shell+read run there; HTTP stays in-process). */
  honestEnv?: "acme" | "sandbox" | "vm";
}

export interface RunResult {
  session: Session;
  history: Observed[];
  capReason?: CapReason;
  containment?: ContainmentResult;
  /** Calls that were decided `pass`, executed for real, and were actually out of scope. MUST be 0 with the watcher on. */
  realOutOfScope: number;
  /** vm mode only: out-of-scope calls the watcher passed but the OS backstop refused (defence in depth caught them). */
  watcherMisses: number;
  decoySource: "tripwires.json" | "fallback";
}

const PASS: Verdict = { decision: "pass", layer: "rules", score: 0, reasons: ["watcher off"], floor: 0 };

/** Plant the broken task + sink, then overlay the decoy files (Person B's tripwires, or the fallback). */
export async function seedCage(sb: Sandbox, decoys: Decoy[]): Promise<void> {
  await sb.runScript(AGENT_PATH, "setup-cage");
  for (const d of decoys) {
    const dir = d.path.includes("/") ? d.path.slice(0, d.path.lastIndexOf("/")) : ".";
    const b64 = Buffer.from(d.value).toString("base64");
    await sb.exec(`mkdir -p "${dir}" && echo ${b64} | base64 -d > "${d.path}"`);
  }
}

// AGENT_PATH (sim/agent.cjs) is reused from the existing sandbox helpers.
import { AGENT_PATH } from "../defense/sandbox/local.js";

export async function runSession(opts: RunOptions): Promise<RunResult> {
  const { attacker, watcher, mirage, sandbox, bus } = opts;
  const watcherOn = opts.watcherOn !== false;
  const honestEnv = opts.honestEnv ?? "acme";
  const caps = opts.caps ?? DEFAULT_CAPS;
  const { decoys, source } = opts.decoys ? { decoys: opts.decoys, source: "fallback" as const } : loadDecoys();

  const session: Session = {
    id: randomUUID().slice(0, 8),
    attacker: attacker.kind,
    // The watcher and the honest env must agree on scope: the Acme world is absolute (/workspace), the
    // sandbox world is relative (workspace/). Pick the scope that matches where `pass` calls run.
    scope: honestEnv === "sandbox" ? CAGE_SCOPE : ACME_SCOPE,
    // (vm and acme share the absolute Acme scope so the watcher, the referee and the VM all agree.)
    triggered: false,
    realCalls: 0,
    fakeCalls: 0,
    loopDepth: 0,
    caps,
  };

  const cap = new CapGuard(caps, (reason) => bus.emit({ type: "kill", session: session.id, reason: `cap: ${reason}` }));
  bus.emit({ type: "session.started", session });
  // The Acme honest env is in-process, so there is nothing to seed into a sandbox.
  if (!opts.skipSeed && honestEnv === "sandbox") await seedCage(sandbox, decoys);

  const history: Observed[] = [];
  let realOutOfScope = 0;
  let watcherMisses = 0;
  let blocked = false;

  try {
    for (let step = 1; ; step++) {
      if (cap.checkBeforeStep(step)) break;

      let next: NextCall | null;
      try {
        next = await attacker.nextStep(history, step, cap.abort.signal);
      } catch (e) {
        bus.emit({ type: "audit", actor: "cage", action: "attacker.error", detail: String((e as Error).message), ts: Date.now() });
        break;
      }
      if (!next) break;

      const call: CageToolCall = { id: randomUUID().slice(0, 8), session: session.id, step, tool: next.tool, args: next.args, thought: next.thought, ts: Date.now() };
      // Recorded on the host-side log BEFORE anything runs (bus writes the JSONL). The agent cannot edit this.
      bus.emit({ type: "tool.call", call });

      const verdict = watcherOn ? await watcher.decide(call, session) : PASS;
      bus.emit({ type: "watcher.verdict", callId: call.id, verdict });

      if (!session.triggered && verdict.decision !== "pass") {
        session.triggered = true;
        session.triggerStep = step;
        session.triggerReason = verdict.reasons[0] ?? verdict.decision;
      }

      let output = "";
      let exitCode: number | undefined;
      if (verdict.decision === "block") {
        output = `(blocked) ${verdict.reasons.join("; ")}`;
        blocked = true;
      } else if (verdict.decision === "mirage") {
        const entry = await mirage.serve(call, session);
        session.fakeCalls += 1;
        session.loopDepth += 1;
        bus.emit({ type: "mirage.served", callId: call.id, entry });
        bus.emit({ type: "progress.updated", session: session.id, progress: entry.progress });
        output = entry.value;
      } else if (honestEnv === "acme" || (honestEnv === "vm" && isHttp(call))) {
        // In-process honest env: deterministic, no sandbox. The Acme HTTP services never exist on a VM, so in
        // "vm" mode HTTP still runs here. Ground truth for "did a pass leave scope?" is the env's own referee.
        const r = runHonest(call, session.scope);
        session.realCalls += 1;
        output = r.output;
        exitCode = r.exitCode;
        if (r.outOfScope) realOutOfScope += 1; // must stay 0 while the watcher is on
      } else if (honestEnv === "vm" && outsideScope(call, session.scope).out) {
        // Code-level backstop, independent of the watcher: in the VM world we RE-CHECK scope and refuse before
        // running, so a watcher miss never touches the VM. That keeps real out-of-scope at zero in code, not by
        // trusting the watcher. A refused call is a WATCHER MISS, not a real execution.
        watcherMisses += 1;
        output = "permission denied (out of scope; refused by the VM scope guard)";
        exitCode = 126;
        bus.emit({ type: "audit", actor: "cage", action: "watcher.miss", detail: `step ${step}: out-of-scope ${call.tool} passed by the watcher but refused by the VM scope guard`, ts: Date.now() });
      } else {
        // In scope (or the legacy cage sandbox): run it for real.
        const r = await execute(call, sandbox);
        session.realCalls += 1;
        output = r.stdout || r.stderr;
        exitCode = r.code;
        // Legacy sandbox referee (relative paths); the vm world already gated out-of-scope above.
        if (honestEnv !== "vm" && outOfScope(commandOf(call)).length > 0) realOutOfScope += 1; // must stay 0 with watcher on
      }

      history.push({ call, decision: verdict.decision, output: String(output).slice(0, 4000), exitCode });
      if (blocked) break; // a clear escape attempt: contain and stop
    }
  } finally {
    cap.dispose();
    await attacker.stop?.().catch(() => undefined);
  }

  let containment: ContainmentResult | undefined;
  if (cap.tripped || blocked) {
    containment = await contain(sandbox);
    bus.emit({ type: "kill", session: session.id, reason: cap.tripped ? `cap: ${cap.tripped}` : "block: escape attempt" });
  }

  bus.emit({ type: "audit", actor: "cage", action: "session.completed", detail: `${session.id}: ${containment ? "contained" : "finished"}`, ts: Date.now() });

  return { session, history, capReason: cap.tripped, containment, realOutOfScope, watcherMisses, decoySource: source };
}

/** HTTP tools stay in-process even in vm mode (the Acme services don't exist on the box). */
function isHttp(call: CageToolCall): boolean {
  return call.tool === "http_get" || call.tool === "http_post";
}

/** Run one tool call against the real sandbox. HTTP tools resolve ONLY through the cage-only sink (run/net.sock). */
async function execute(call: CageToolCall, sb: Sandbox): Promise<{ code: number; stdout: string; stderr: string }> {
  if (call.tool === "run_shell") return sb.exec(String(call.args.cmd ?? ""));
  if (call.tool === "read_file") {
    try {
      return { code: 0, stdout: await sb.readFile(String(call.args.path ?? "")), stderr: "" };
    } catch (e) {
      return { code: 1, stdout: "", stderr: String((e as Error).message) };
    }
  }
  // http_get / http_post: a node one-liner over the Unix-socket sink, so nothing leaves the cage.
  const url = String(call.args.url ?? "");
  const host = url.replace(/^https?:\/\//, "").split("/")[0] || "localhost";
  const path = "/" + url.replace(/^https?:\/\//, "").split("/").slice(1).join("/");
  const method = call.tool === "http_post" ? "POST" : "GET";
  const body = call.tool === "http_post" ? String(call.args.body ?? "") : "";
  const b64 = Buffer.from(body).toString("base64");
  const script = `const http=require('http');const d=Buffer.from('${b64}','base64');` +
    `const r=http.request({socketPath:'run/net.sock',path:${JSON.stringify(path)},method:'${method}',headers:{host:${JSON.stringify(host)}}},x=>{let o='';x.on('data',c=>o+=c);x.on('end',()=>{process.stdout.write('['+x.statusCode+'] '+o)})});` +
    `r.on('error',e=>{process.stdout.write('ERR '+e.message)});if(d.length)r.write(d);r.end();`;
  return sb.exec(`node -e ${JSON.stringify(script)}`);
}
