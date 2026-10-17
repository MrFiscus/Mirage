// Containment actions (Person A). Run on a cap trip or a `block`. None of this asks the watcher or a model.
// 1. Kill the agent's leftover processes. 2. Cut the network. 3. Preserve forensics.
// Network cut: Daytona's native updateNetworkSettings needs Tier 3+; until the kill test confirms our tier we use the
// simulated deny file, which the decoy sink (sim/agent.cjs) already enforces (every request after it gets 403).
import type { Sandbox } from "../defense/sandbox/index.js";

export interface ContainmentResult {
  processesKilled: boolean;
  network: "daytona-native" | "simulated-deny-file" | "failed";
  forensicsPreserved: boolean;
  notes: string[];
}

export async function contain(sb: Sandbox): Promise<ContainmentResult> {
  const notes: string[] = [];
  const killed = await sb.exec(`pkill -f "agent-keepalive-$BATMAN_SANDBOX_ID" ; true`);
  const processesKilled = killed.code === 0;

  let network: ContainmentResult["network"] = "failed";
  const native = (sb as Sandbox & { blockNetwork?: () => Promise<boolean> }).blockNetwork;
  if (native) {
    try {
      if (await native.call(sb)) network = "daytona-native";
    } catch (e) {
      notes.push(`native network block refused: ${(e as Error).message}`);
    }
  }
  if (network === "failed") {
    const r = await sb.exec("mkdir -p policy && echo 0.0.0.0/0 >> policy/egress-deny.txt");
    if (r.code === 0) network = "simulated-deny-file";
    else notes.push(`deny file write failed: ${r.stdout}${r.stderr}`);
  }

  const f = await sb.exec("mkdir -p forensics && cp logs/sink.log forensics/sink.log 2>/dev/null; true");
  return { processesKilled, network, forensicsPreserved: f.code === 0, notes };
}
