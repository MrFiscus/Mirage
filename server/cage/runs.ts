// Run registry (Person A): the per-session forensic logs on disk plus the run.summary of every session this process
// has seen. Backs GET /cage/runs, GET /cage/runs/:session and GET /mirage/forensics. Read-only over the JSONL the
// harness wrote (the agent never had access to these files).
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { RunSummary } from "../../shared/types.js";

export const CAGE_RUNS_DIR = "data/cage-runs";

const summaries = new Map<string, RunSummary>();
const MAX_SUMMARIES = 2000;

export function recordSummary(s: RunSummary): void {
  summaries.set(s.session, s);
  if (summaries.size > MAX_SUMMARIES) summaries.delete(summaries.keys().next().value!);
}

export const getSummary = (session: string): RunSummary | undefined => summaries.get(session);
export const listSummaries = (): RunSummary[] => [...summaries.values()].sort((a, b) => b.ts - a.ts);

export interface RunFile { session: string; attacker: string; path: string; ts: number }

/** Every forensic JSONL under data/cage-runs (one level of subdirectories: fleet runs), newest first. */
export function listRunFiles(dir = CAGE_RUNS_DIR): RunFile[] {
  if (!existsSync(dir)) return [];
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) for (const inner of readdirSync(p)) if (inner.endsWith(".jsonl")) files.push(join(p, inner));
    else if (name.endsWith(".jsonl")) files.push(p);
  }
  const out: RunFile[] = [];
  for (const path of files) {
    const head = firstLine(path);
    if (!head) continue;
    try {
      const e = JSON.parse(head) as { type?: string; session?: { id: string; attacker: string } };
      if (e.type !== "session.started" || !e.session) continue;
      out.push({ session: e.session.id, attacker: e.session.attacker, path: path.replace(/\\/g, "/"), ts: statSync(path).mtimeMs });
    } catch { /* not a cage log */ }
  }
  return out.sort((a, b) => b.ts - a.ts);
}

export function findRunFile(session: string, dir = CAGE_RUNS_DIR): string | undefined {
  const known = summaries.get(session)?.forensicPath;
  if (known && existsSync(known)) return known;
  return listRunFiles(dir).find((f) => f.session === session)?.path;
}

function firstLine(path: string): string | undefined {
  try {
    const buf = readFileSync(path, "utf8");
    const i = buf.indexOf("\n");
    return (i >= 0 ? buf.slice(0, i) : buf).trim() || undefined;
  } catch { return undefined; }
}
