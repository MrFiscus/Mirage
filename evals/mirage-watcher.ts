// Compare Person D's independent policy labels with Person B's committed rules layer.
// This does not execute tool calls or contact any model, host, or sandbox.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Session, ToolCall, Verdict } from "../shared/types.js";
import { decide, DEFAULT_SCOPE } from "../server/watcher/index.js";

type Label = "in_scope" | "out_of_scope" | "near_miss";
interface Case {
  id: string;
  label: Label;
  expectedDecision: Verdict["decision"];
  reason: string;
  call: ToolCall;
}

const casesPath = fileURLToPath(new URL("../data/mirage/watcher-cases.json", import.meta.url));
const cases = JSON.parse(readFileSync(casesPath, "utf8")) as Case[];

// Keep this fixture eval deterministic even when a developer has live provider keys in .env.
process.env.WATCHER_LLM = "off";
delete process.env.WATCHER_MODE;

function sessionFor(call: ToolCall): Session {
  return {
    id: call.session,
    attacker: "scripted",
    scope: DEFAULT_SCOPE,
    triggered: false,
    realCalls: 0,
    fakeCalls: 0,
    loopDepth: 0,
    caps: { steps: 20, seconds: 120, spendUsd: 1 },
  };
}

const results: { id: string; label: Label; expected: string; actual: string; passed: boolean; reasons: string[] }[] = [];
for (const item of cases) {
  // Each labeled call is independent. Disable pressure and event emission so the only
  // result under test is the committed rules decision.
  const verdict = await decide(item.call, sessionFor(item.call), { pressure: false, emitEvent: false });
  results.push({
    id: item.id,
    label: item.label,
    expected: item.expectedDecision,
    actual: verdict.decision,
    passed: verdict.decision === item.expectedDecision,
    reasons: verdict.reasons,
  });
}

for (const r of results) {
  console.log(`${r.passed ? "PASS" : "FAIL"} ${r.id}: expected ${r.expected}, got ${r.actual}${r.passed ? "" : ` (${r.reasons.join("; ") || "no rule matched"})`}`);
}
const passed = results.filter((r) => r.passed).length;
const falsePositives = results.filter((r) => r.actual !== "pass" && r.expected === "pass").length;
const falseNegatives = results.filter((r) => r.actual === "pass" && r.expected !== "pass").length;
console.log(`Watcher rules: ${passed}/${results.length} labels matched; ${falsePositives} false positives; ${falseNegatives} false negatives.`);
if (passed !== results.length) process.exitCode = 1;
