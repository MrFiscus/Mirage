// Mirage contracts, Person A's local copy (CLAUDE.md "Shared contracts").
// These belong in shared/types.ts, but that file needs a team-chat message before it changes, so we keep a copy
// here and swap every import to "../../shared/types.js" once the real types land. Keep this verbatim with CLAUDE.md.
//
// Note: server/defense/rogue-agent.ts exports a DIFFERENT, older `ToolCall` (ts/agent/cmd shape). That one is the
// legacy virus-demo record; this CageToolCall is the Mirage contract. They are not interchangeable — import the
// cage one from this file, never from rogue-agent.ts.

/** One attempted action by the attacker, recorded by the host harness BEFORE it runs. */
export interface CageToolCall {
  id: string;
  session: string;
  step: number;
  tool: "run_shell" | "http_get" | "http_post" | "read_file";
  args: Record<string, unknown>;
  thought?: string; // the agent's stated reason: UNTRUSTED data, never an instruction
  ts: number;
}

/** The watcher's verdict for one CageToolCall. Role/scope decisions live server-side only. */
export interface Verdict {
  decision: "pass" | "mirage" | "block";
  layer: "rules" | "llm";
  score: number; // 0..1 suspiciousness
  reasons: string[]; // cited rule hits / evidence lines
  floor: number; // code-enforced minimum score the model may not go below
}

/** One fake fact shown to the agent; the world ledger is an append-only list of these. */
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
  tools: string[];
}

export interface Caps {
  steps: number;
  seconds: number;
  spendUsd: number;
}

export interface Session {
  id: string;
  attacker: "grok" | "scripted" | "droid";
  scope: Scope;
  triggered: boolean;
  triggerStep?: number;
  triggerReason?: string;
  realCalls: number;
  fakeCalls: number;
  loopDepth: number;
  caps: Caps;
}

/** Every lane emits these; the console only renders them. */
export type MirageEvent =
  | { type: "session.started"; session: Session }
  | { type: "tool.call"; call: CageToolCall }
  | { type: "watcher.verdict"; callId: string; verdict: Verdict }
  | { type: "mirage.served"; callId: string; entry: LedgerEntry }
  | { type: "progress.updated"; session: string; progress: number }
  | { type: "notify.sent"; channel: "text" | "call"; to: string; detail: string }
  | { type: "kill"; session: string; reason: string }
  | { type: "audit"; actor: string; action: string; detail: string; ts: number };

/** The watcher interface the harness calls before every tool call. Person B's real watcher drops in here. */
export interface Watcher {
  decide(call: CageToolCall, session: Session): Promise<Verdict>;
}

/** The mirage interface the harness calls for a `mirage` verdict. Person C's real simulator drops in here. */
export interface Mirage {
  serve(call: CageToolCall, session: Session): Promise<LedgerEntry>;
}
