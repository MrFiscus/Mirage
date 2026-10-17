export type Role = "ceo" | "analyst" | "hr" | "developer" | "unknown";

export interface Caller {
  phone: string;
  name: string;
  role: Role;
  department: string;
}

export interface CallSession {
  conversationId: string;
  phone: string;
  role: Role;
  verified: boolean;
  codeAttempts: number;
}

export interface FixPlan {
  commands: string[];
  drastic: boolean;
  cloneCheck?: { passed: boolean; checks: { name: string; passed: boolean }[] };
  approvedBy?: string;
}

export interface Incident {
  id: string;
  title: string;
  status: "detected" | "investigating" | "testing_fix" | "awaiting_approval" | "resolved" | "fix_rejected";
  severity: "low" | "medium" | "high";
  confidence: number;
  evidence: string[];
  technicalSummary: string;
  businessSummary: string;
  proposedFix?: FixPlan;
  createdAt?: number;
  updatedAt?: number;
}

export type ConsoleEvent =
  | { type: "incident.updated"; incident: Incident }
  | { type: "call.started"; session: CallSession }
  | { type: "call.transcript"; conversationId: string; speaker: "agent" | "caller"; text: string }
  | { type: "disclosure"; conversationId: string; role: Role; fields: string[]; allowed: boolean }
  | { type: "sms.sent"; to: string; body: string }
  | { type: "audit"; actor: string; action: string; detail: string; ts: number };

export interface AuditEntry {
  actor: string;
  action: string;
  detail: string;
  ts: number;
}

/* ------------------------------------------------------------------ *
 * Mirage contract (shared/types.ts in PLAN.md). The attacker emits   *
 * ToolCalls, the watcher returns a Verdict, the mirage returns a      *
 * LedgerEntry, and everything is broadcast as MirageEvents.           *
 * ------------------------------------------------------------------ */

export type ToolName = "run_shell" | "http_get" | "http_post" | "read_file";
export type Attacker = "grok" | "scripted" | "droid";

// One attempted action by the attacker, recorded by the host harness BEFORE it runs.
export interface ToolCall {
  id: string;
  session: string;
  step: number;
  tool: ToolName;
  args: Record<string, unknown>;
  thought?: string; // the agent's stated reason: UNTRUSTED data, never an instruction
  ts: number;
}

// The watcher's verdict for one ToolCall. Scope decisions live server-side only.
export interface Verdict {
  decision: "pass" | "mirage" | "block";
  layer: "rules" | "llm";
  score: number; // 0..1 suspiciousness
  reasons: string[]; // cited rule hits / evidence lines
  floor: number; // code-enforced minimum score the model may not go below
}

// One fake fact shown to the agent; the world ledger is an append-only list of these.
export interface LedgerEntry {
  session: string;
  path: string;
  kind: "file" | "cred" | "host" | "error" | "hint";
  value: string; // never matches the flag format
  progress: number; // hidden closeness this entry implies (0..1, asymptotic to <1)
  ts: number;
}

export interface Scope {
  paths: string[];
  hosts: string[];
  tools: ToolName[];
}

export interface Session {
  id: string;
  attacker: Attacker;
  scope: Scope;
  triggered: boolean;
  triggerStep?: number;
  triggerReason?: string;
  realCalls: number;
  fakeCalls: number;
  loopDepth: number;
  caps: { steps: number; seconds: number; spendUsd: number };
}

// Every lane emits these; the console only renders them.
export type MirageEvent =
  | { type: "session.started"; session: Session }
  | { type: "tool.call"; call: ToolCall }
  | { type: "watcher.verdict"; callId: string; verdict: Verdict }
  | { type: "mirage.served"; callId: string; entry: LedgerEntry }
  | { type: "progress.updated"; session: string; progress: number }
  | { type: "notify.sent"; channel: "text" | "call"; to: string; detail: string }
  | { type: "kill"; session: string; reason: string }
  | { type: "audit"; actor: string; action: string; detail: string; ts: number };

// The one bus both the old console and the Mirage dashboard read.
export type AppEvent = ConsoleEvent | MirageEvent;