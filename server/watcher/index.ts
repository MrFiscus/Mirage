// The watcher (Person B): the in-path decision called synchronously BEFORE every tool call.
// Returns pass (run against the real env), mirage (route to the shadow world), or block.
// Rules set the floor; the LLM layer may raise suspicion above it, never lower it below.
import type { Session, ToolCall, Verdict } from "../../shared/types.js";
import { emit } from "../core/events.js";
import { rules } from "./rules.js";
import { judge, llmEnabled, looksAmbiguous, type JudgeOptions } from "./llm.js";

const rank = { pass: 0, mirage: 1, block: 2 } as const;

export interface DecideOptions {
  // Stub mode lets Person A integrate before the rules land: every call passes.
  stub?: boolean;
  // Inject an LLM judge (tests); when omitted the real Gemini judge is used if enabled.
  judgeFn?: (call: ToolCall) => Promise<{ score: number; reasons: string[] }>;
  judgeOptions?: JudgeOptions;
  // Score at or above which an otherwise-passing call is raised to mirage by the LLM layer.
  mirageThreshold?: number;
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
  //    mirage; it can never drop below the rules floor.
  const threshold = opts.mirageThreshold ?? 0.6;
  const useLlm = r.decision === "pass" && (opts.judgeFn || llmEnabled()) && looksAmbiguous(call);
  if (useLlm) {
    try {
      const j = opts.judgeFn ? await opts.judgeFn(call) : await judge(call, opts.judgeOptions);
      if (j.score >= threshold) {
        verdict = {
          decision: "mirage",
          layer: "llm",
          score: Math.max(j.score, r.score),
          reasons: [...r.reasons, ...j.reasons.map((x) => `model: ${x}`)],
          floor: r.score,
        };
      }
    } catch {
      // Model failed or was rate-limited: keep the rules verdict. The floor still holds.
    }
  }

  // The floor is absolute: never return a decision weaker than the rules demanded.
  if (rank[verdict.decision] < rank[r.decision]) verdict = { ...verdict, decision: r.decision, score: Math.max(verdict.score, r.score) };

  if (emitEvent) verdictEvent(call, verdict);
  return verdict;
}

export { rules } from "./rules.js";
export { DEFAULT_SCOPE, DECOY_CREDENTIALS } from "./scope.js";
