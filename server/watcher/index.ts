// The watcher (Person B): the in-path decision called synchronously BEFORE every tool call.
// Returns pass (run against the real env), mirage (route to the shadow world), or block.
// Rules set the floor; the LLM layer may raise suspicion above it, never lower it below.
import type { Session, ToolCall, Verdict } from "../../shared/types.js";
import { emit } from "../core/events.js";
import { rules } from "./rules.js";
import { judge, llmEnabled, llmReady, looksAmbiguous, recordLlmResult, type JudgeOptions } from "./llm.js";
import { adjustedThreshold, sharedPressure, type PressureTracker } from "./pressure.js";

const rank = { pass: 0, mirage: 1, block: 2 } as const;

export interface DecideOptions {
  // Stub mode lets Person A integrate before the rules land: every call passes.
  stub?: boolean;
  // Inject an LLM judge (tests); when omitted the real Gemini judge is used if enabled.
  judgeFn?: (call: ToolCall) => Promise<{ score: number; reasons: string[] }>;
  judgeOptions?: JudgeOptions;
  // Score at or above which an otherwise-passing call is raised to mirage by the LLM layer.
  mirageThreshold?: number;
  // Pressure gauge; pass false to disable, or a tracker (tests). Defaults to the shared one.
  pressure?: PressureTracker | false;
  // Emit the watcher.verdict event (default true).
  emitEvent?: boolean;
}

function verdictEvent(call: ToolCall, verdict: Verdict): void {
  emit({ type: "watcher.verdict", callId: call.id, verdict });
  emit({ type: "audit", actor: "watcher", action: `verdict.${verdict.decision}`, detail: `${call.tool} step ${call.step}: ${verdict.reasons[0] ?? "in scope"}`, ts: Date.now() });
}

export async function decide(call: ToolCall, session: Session, opts: DecideOptions = {}): Promise<Verdict> {
  const emitEvent = opts.emitEvent !== false;

  if (opts.stub || process.env.WATCHER_MODE === "stub") {
    const verdict: Verdict = { decision: "pass", layer: "rules", score: 0, reasons: [], floor: 0 };
    if (emitEvent) verdictEvent(call, verdict);
    return verdict;
  }

  // 1. Rules layer: deterministic, and the floor.
  const r = rules(call, session.scope);
  let verdict: Verdict = { decision: r.decision, layer: "rules", score: r.score, reasons: r.reasons, floor: r.score };

  // 2. LLM layer: only when the rules passed the call but it still smells off. It can raise a pass to
  //    mirage; it can never drop below the rules floor. The pressure gauge lowers the threshold as a
  //    session gets more frustrated, so the next crossing is caught sooner.
  const tracker = opts.pressure === false ? null : opts.pressure ?? sharedPressure;
  const base = opts.mirageThreshold ?? 0.6;
  const threshold = tracker ? adjustedThreshold(base, tracker.get(session.id)) : base;
  // The circuit breaker (llmReady) only gates the real provider, never an injected test judge.
  const useLlm = r.decision === "pass" && (opts.judgeFn || (llmEnabled() && llmReady())) && looksAmbiguous(call);
  if (useLlm) {
    try {
      const j = opts.judgeFn ? await opts.judgeFn(call) : await judge(call, { ...opts.judgeOptions, scope: session.scope });
      if (!opts.judgeFn) recordLlmResult(true);
      // Make the raw model score (and the raw JSON) visible next to the code floor, whether or not it tripped.
      const note = `model score ${j.score.toFixed(2)} (threshold ${threshold.toFixed(2)}, floor ${r.score.toFixed(2)})`;
      const raw = (j as { raw?: string }).raw;
      const rawNote = raw ? [`model.raw: ${raw.replace(/\s+/g, " ").slice(0, 240)}`] : [];
      if (j.score >= threshold) {
        verdict = {
          decision: "mirage",
          layer: "llm",
          score: Math.max(j.score, r.score),
          reasons: [...r.reasons, note, ...j.reasons.map((x) => `model: ${x}`), ...rawNote],
          floor: r.score,
        };
      } else {
        verdict = { ...verdict, reasons: [...verdict.reasons, note, ...rawNote] };
      }
    } catch {
      // Model failed or was rate-limited: keep the rules verdict. The floor still holds.
      if (!opts.judgeFn) recordLlmResult(false);
    }
  }

  // The floor is absolute: never return a decision weaker than the rules demanded.
  if (rank[verdict.decision] < rank[r.decision]) verdict = { ...verdict, decision: r.decision, score: Math.max(verdict.score, r.score) };

  if (tracker) {
    const before = tracker.get(session.id);
    const after = tracker.bump(session.id, verdict.decision);
    if (before < 0.5 && after >= 0.5) emit({ type: "audit", actor: "watcher", action: "pressure.high", detail: `session ${session.id} is probing repeatedly (pressure ${after.toFixed(2)})`, ts: Date.now() });
  }

  if (emitEvent) verdictEvent(call, verdict);
  return verdict;
}

export { rules } from "./rules.js";
export { DEFAULT_SCOPE, DECOY_CREDENTIALS, DECOYS } from "./scope.js";
export { PressureTracker, sharedPressure } from "./pressure.js";
