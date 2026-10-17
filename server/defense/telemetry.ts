import type { Sandbox } from "./sandbox/index.js";

export interface HealthCheck { name: string; passed: boolean; detail?: string; }
export interface Telemetry {
  processes: string[];   // suspicious process lines
  outbound: string[];    // OUTBOUND lines from the network log
  cron: string[];        // entries in cron/
  health: HealthCheck[];
}

// Read-only, fixed queries. Nothing from logs or the model ever becomes a command.
const QUERIES = {
  processes: 'ps -eo pid,args | grep "[r]ogue-miner-$BATMAN_SANDBOX_ID" || true',
  outbound: "grep OUTBOUND logs/network.log || true",
  cron: "ls cron | grep -v '^.keep$' || true",
  health: "node health.cjs || true",
} as const;
export type QueryName = keyof typeof QUERIES;

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);

export async function runQuery(sb: Sandbox, name: QueryName): Promise<string> {
  const cmd = QUERIES[name];
  if (!cmd) throw new Error(`unknown query: ${String(name)}`);
  return (await sb.exec(cmd)).stdout;
}

export async function collectHealth(sb: Sandbox): Promise<HealthCheck[]> {
  try { return JSON.parse(await runQuery(sb, "health")).checks; }
  catch { return [{ name: "health report", passed: false, detail: "unparseable" }]; }
}

export async function collectTelemetry(sb: Sandbox): Promise<Telemetry> {
  const [p, o, c, health] = await Promise.all([
    runQuery(sb, "processes"), runQuery(sb, "outbound"), runQuery(sb, "cron"), collectHealth(sb),
  ]);
  return { processes: lines(p), outbound: lines(o), cron: lines(c), health };
}
