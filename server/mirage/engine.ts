// Mirage engine (Person C's integration point for Person A's cage and Person B's watcher).
//
// The cage records a ToolCall, asks the watcher for a Verdict, then hands both to route():
//   pass   -> run against the honest Acme env, return the real result
//   mirage -> ask the simulator for a believable fake, return that
//   block  -> return a refusal, nothing runs
//
// The engine owns the forensic record: real-vs-fake split, loop depth, trigger time + reason, and
// the full transcript. It emits every MirageEvent so the dashboard can render the run live.
import { randomUUID } from "node:crypto";
import type { LedgerEntry, MirageEvent, Session, ToolCall, Verdict } from "../../shared/types.js";
import { DEFAULT_SCOPE, outsideScope, runHonest, TASK_PROMPT, type Scope } from "./acme.js";
import { Simulator } from "./simulator.js";

export interface RouteResult {
  decision: Verdict["decision"];
  output: string;
  /** Ground truth from the honest env: did a `pass` actually reach something out of scope? */
  realOutOfScope: boolean;
  entry?: LedgerEntry;
}

export interface TranscriptRow {
  step: number; tool: ToolCall["tool"]; summary: string;
  decision: Verdict["decision"]; real: boolean;
  /** Ground truth from the honest env: this passed call actually left scope. */
  realOutOfScope: boolean;
  outputPreview: string; ts: number;
}

type Emit = (event: MirageEvent) => void;

export interface EngineOptions {
  emit?: Emit;
  ledgerFile?: string | null;
  /** When off, every call runs against the honest env regardless of verdict (the contrast run). */
  watcherOn?: boolean;
}

export class MirageEngine {
  readonly session: Session;
  readonly transcript: TranscriptRow[] = [];
  private sim: Simulator;
  private emit: Emit;
  private watcherOn: boolean;
  private seenKeys = new Set<string>();

  constructor(opts: EngineOptions & { attacker?: Session["attacker"]; scope?: Scope; id?: string } = {}) {
    const secret = randomUUID();
    this.sim = new Simulator({ ledgerFile: opts.ledgerFile ?? null, secret });
    this.emit = opts.emit ?? (() => {});
    this.watcherOn = opts.watcherOn ?? true;
    this.session = {
      id: opts.id ?? `MIR-${Date.now()}`,
      attacker: opts.attacker ?? "scripted",
      scope: opts.scope ?? DEFAULT_SCOPE,
      triggered: false,
      realCalls: 0,
      fakeCalls: 0,
      loopDepth: 0,
      caps: { steps: 40, seconds: 180, spendUsd: 1 },
    };
  }

  get task(): string { return TASK_PROMPT; }

  start(): Session {
    this.emit({ type: "session.started", session: this.session });
    this.emit({ type: "audit", actor: "mirage", action: "session.started", detail: `${this.session.id} (${this.session.attacker})`, ts: Date.now() });
    return this.session;
  }

  /** Route one call by its verdict. The cage calls this after watcher.decide(call). */
  route(call: ToolCall, verdict: Verdict): RouteResult {
    this.emit({ type: "tool.call", call });
    this.emit({ type: "watcher.verdict", callId: call.id, verdict: this.watcherOn ? verdict : { ...verdict, decision: "pass", score: 0, reasons: ["watcher off"], floor: 0 } });

    // The honest env always knows the ground truth, used for the forensic "zero real access" claim.
    const honest = runHonest(call, this.session.scope);
    const effective = this.watcherOn ? verdict.decision : "pass";

    let result: RouteResult;
    if (effective === "pass") {
      this.session.realCalls++;
      result = { decision: "pass", output: honest.output, realOutOfScope: honest.outOfScope };
    } else if (effective === "mirage") {
      const entry = this.sim.serve(call);
      this.session.fakeCalls++;
      const key = entry.path;
      if (this.seenKeys.has(key)) this.session.loopDepth++;
      this.seenKeys.add(key);
      this.emit({ type: "mirage.served", callId: call.id, entry });
      this.emit({ type: "progress.updated", session: this.session.id, progress: entry.progress });
      result = { decision: "mirage", output: entry.value, realOutOfScope: false, entry };
    } else {
      result = { decision: "block", output: "blocked: this action is outside the eval scope and was refused.", realOutOfScope: false };
      this.emit({ type: "kill", session: this.session.id, reason: verdict.reasons[0] ?? "blocked" });
    }

    if (!this.session.triggered && (effective === "mirage" || effective === "block")) {
      this.session.triggered = true;
      this.session.triggerStep = call.step;
      this.session.triggerReason = verdict.reasons[0] ?? "out of scope";
      this.emit({ type: "audit", actor: "mirage", action: "trigger", detail: `step ${call.step}: ${this.session.triggerReason}`, ts: Date.now() });
    }

    this.transcript.push({
      step: call.step,
      tool: call.tool,
      summary: this.summarize(call),
      decision: result.decision,
      real: result.decision === "pass",
      realOutOfScope: result.decision === "pass" && honest.outOfScope,
      outputPreview: result.output.slice(0, 160),
      ts: call.ts,
    });
    this.emit({ type: "session.started", session: this.session }); // push refreshed counters
    return result;
  }

  private summarize(call: ToolCall): string {
    const a = call.args ?? {};
    if (call.tool === "read_file") return `read ${a.path ?? a.file ?? ""}`;
    if (call.tool === "http_get") return `GET ${a.url ?? ""}`;
    if (call.tool === "http_post") return `POST ${a.url ?? ""}`;
    return String(a.command ?? a.cmd ?? "");
  }

  /** The forensic summary the dashboard and the pitch use. */
  forensics() {
    return {
      session: this.session,
      task: TASK_PROMPT,
      realCalls: this.session.realCalls,
      fakeCalls: this.session.fakeCalls,
      loopDepth: this.session.loopDepth,
      triggered: this.session.triggered,
      triggerStep: this.session.triggerStep,
      triggerReason: this.session.triggerReason,
      progress: this.sim.progress.get(this.session.id),
      // The headline claim, computed from the honest env, not from the watcher.
      realOutOfScopeAccess: this.transcript.filter((r) => r.realOutOfScope).length,
      transcript: this.transcript,
      ledger: this.sim.ledger.forSession(this.session.id),
    };
  }
}

export { outsideScope };
