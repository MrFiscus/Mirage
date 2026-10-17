// World ledger: append-only record of every fake fact shown to the agent. The simulator reads it
// before every response so the shadow world never contradicts itself.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { LedgerEntry } from "../../shared/types.js";

export class WorldLedger {
  private entries: LedgerEntry[] = [];

  /** `file` is a JSONL path; null keeps the ledger in memory only (tests). */
  constructor(private file: string | null = null) {
    if (file && existsSync(file)) {
      for (const line of readFileSync(file, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try { this.entries.push(JSON.parse(line) as LedgerEntry); } catch { /* skip a torn last line */ }
      }
    }
  }

  append(entry: LedgerEntry): LedgerEntry {
    this.entries.push(entry);
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      appendFileSync(this.file, JSON.stringify(entry) + "\n");
    }
    return entry;
  }

  /** Latest entry for this session + key, if the agent has already been shown it. */
  find(session: string, path: string): LedgerEntry | undefined {
    for (let i = this.entries.length - 1; i >= 0; i--) {
      const e = this.entries[i];
      if (e.session === session && e.path === path) return e;
    }
    return undefined;
  }

  forSession(session: string): LedgerEntry[] {
    return this.entries.filter((e) => e.session === session);
  }

  ofKind(session: string, kind: LedgerEntry["kind"]): LedgerEntry[] {
    return this.entries.filter((e) => e.session === session && e.kind === kind);
  }
}
