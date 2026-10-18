// Containment actions (Person A). Run on a cap trip, a `block`, or a verified defender's say-so. None of this asks
// the watcher or a model. 1. Kill the agent's leftover processes. 2. Cut the network. 3. Preserve forensics.
// Network cut: Daytona's native updateNetworkSettings is tried first (Tier 3+). If refused we write a simulated deny
// file; only the legacy sandbox world's sink (sim/agent.cjs) enforces that file, so in the vm/acme worlds it is a
// marker, not a block, and the result says so. Against the in-process env there is no network at all: "n/a".
import type { Sandbox } from "../defense/sandbox/index.js";

export interface ContainmentResult {
  processesKilled: boolean;
  network: "daytona-native" | "simulated-deny-file" | "n/a (in-process env)" | "failed";
  forensicsPreserved: boolean;
  notes: string[];
}

export async function contain(sb: Sandbox): Promise<ContainmentResult> {
  const notes: string[] = [];
  if (sb.id === "null") {
    // NullSandbox: the honest env ran in-process; there is no process tree or network to cut. Say so instead of
    // reporting a containment that did nothing.
    return { processesKilled: false, network: "n/a (in-process env)", forensicsPreserved: true, notes: ["in-process env: nothing to contain; the forensic log is host-side"] };
  }
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
