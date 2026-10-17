import { analystPhone } from "./apply";
import { approve } from "./approval";
import { cleanup, startScenario } from "./orchestrator";
import { getIncident, onEvent } from "./mocks/core";

const scenario = process.argv[2] ?? "1";
const autoApprove = process.argv.includes("--approve");

onEvent((e) => {
  if (e.type === "incident.updated") console.log(`[incident] ${e.incident.id} -> ${e.incident.status}`);
  else if (e.type === "sms.sent") console.log(`[sms -> ${e.to}] ${e.body}`);
  else if (e.type === "audit") console.log(`[audit] ${e.action}: ${e.detail}`);
});

const incident = await startScenario(scenario);
if (incident.status === "awaiting_approval" && autoApprove) await approve(incident.id, analystPhone());
else if (incident.status === "awaiting_approval") console.log("Awaiting approval. Re-run with --approve to simulate the analyst texting APPROVE.");
console.log("final status:", getIncident(incident.id)?.status);
await cleanup(incident.id);
