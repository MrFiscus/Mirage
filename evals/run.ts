// Batman eval harness. `npm run eval` measures the real engine and voice tools, not copies of them.
// Writes evals/results.json (machine-readable, for Chalk) and evals/results.md (the table for Devpost).
//   EVAL_INVESTIGATOR=gemini  measure the Gemini investigator instead of rules (spends API quota)
//   SANDBOX_BACKEND=daytona   run the fix-safety sandboxes on Daytona instead of local temp dirs
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join, resolve } from "node:path";
import type { LabeledCase } from "./build-cases.js";
import type { Metric } from "./metric.js";

const root = process.cwd();
const cases = JSON.parse(readFileSync(resolve(root, "data/events.json"), "utf8")) as LabeledCase[];

// The store persists to <cwd>/data at import time, so move into a throwaway copy before loading it.
const scratch = mkdtempSync(join(tmpdir(), "batman-eval-"));
cpSync(resolve(root, "data"), join(scratch, "data"), { recursive: true });
process.chdir(scratch);

if (process.env.EVAL_INVESTIGATOR === "gemini") {
  try { process.loadEnvFile(resolve(root, ".env")); } catch { /* keys may come from the shell */ }
  process.env.INVESTIGATOR = "gemini";
}
const { createInvestigator } = await import("../server/defense/investigators.js");
const { detectionSuite } = await import("./detection.js");
const { fixSafetySuite } = await import("./fix-safety.js");
const { disclosureSuite } = await import("./disclosure.js");

const investigator = createInvestigator();
const engine = investigator.constructor.name.replace("Investigator", "").toLowerCase() || "unknown";
const started = Date.now();
const metrics: Metric[] = [
  ...(await detectionSuite(cases, investigator)),
  ...(await fixSafetySuite()),
  ...(await disclosureSuite()),
];
const seconds = ((Date.now() - started) / 1000).toFixed(1);

const env = { investigator: engine, sandbox: process.env.SANDBOX_BACKEND === "daytona" ? "daytona" : "local", platform: platform(), cases: cases.length, ranAt: new Date().toISOString(), seconds: Number(seconds) };
const counts = (l: string) => cases.filter((c) => c.label === l).length;

const table = [
  "| Metric | Result | Basis |",
  "|---|---|---|",
  ...metrics.map((m) => `| ${m.name} | **${m.value}** | ${m.detail} |`),
].join("\n");
const failures = metrics.filter((m) => m.failures.length).map((m) => `**${m.name}**\n${m.failures.map((f) => `- ${f}`).join("\n")}`).join("\n\n");
const md = `# Batman eval results

Measured on synthetic data: ${cases.length} labeled telemetry cases (${counts("virus")} simulated-virus, ${counts("benign")} benign, ${counts("near_miss")} near misses), ${engine} investigator, ${env.sandbox} sandboxes, ${env.platform}. Run ${env.ranAt} in ${seconds}s with \`npm run eval\`.

${table}

## What each metric runs

- **Detection** calls the engine's \`detect()\` on every case. Labels and the severity rubric are in \`evals/build-cases.ts\`.
- **Severity** compares the investigator's severity with the rubric label on every true alert.
- **Unsupported claims** checks that every evidence line is a real telemetry line, and that summaries never claim an indicator that is absent, never say breach or data stolen, and never repeat injected log text.
- **Fix safety** runs harmful and incomplete fixes through the real clone check on real sandboxes, checks the decision rule on every clone-result and risk combination, and runs the full loop with the real planner.
- **Disclosure** drives the voice tools over HTTP exactly as the ElevenLabs agent does.

## Failures and notes

${failures || "None."}
`;

writeFileSync(resolve(root, "evals/results.json"), JSON.stringify({ env, metrics }, null, 2) + "\n");
writeFileSync(resolve(root, "evals/results.md"), md);

console.log(`\nBatman evals  (${engine} investigator, ${env.sandbox} sandboxes, ${cases.length} cases, ${seconds}s)\n`);
const width = Math.max(...metrics.map((m) => m.name.length));
for (const m of metrics) console.log(`  ${m.name.padEnd(width)}  ${m.value.padStart(7)}   ${m.detail}`);
console.log(`\n${failures ? failures.replace(/\*\*/g, "") : "No failures."}\n\nWrote evals/results.md and evals/results.json`);
process.exit(0);
