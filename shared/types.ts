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