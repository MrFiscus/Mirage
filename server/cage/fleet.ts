// The fleet (Person A, System 3). Any number of agents, each in its OWN env, all watched by the one real watcher, all
// emitting onto the core bus so the existing fleet UI renders them (it groups by session id and reacts to
// session.started / tool.call / watcher.verdict and the fleet.starting / fleet.complete audits).
// SCALE: the total is unlimited; only the number running AT ONCE is bounded (`concurrency`, e.g. Daytona's concurrent
// VM limit). Agents queue, each gets a fresh env, and its VM is destroyed before the next one starts.
//
// This is the one fleet: live Droid and/or scripted agents, each composed on the same cage runSession. Every session
// writes its own host-side JSONL under data/cage-runs/<runId>/ (every tool.call recorded before it runs).
import { mkdirSync } from "node:fs";
import type { MirageEvent, RunSummary } from "../../shared/types.js";
import { CAGE_RUNS_DIR } from "./runs.js";
import type { Sandbox } from "../defense/sandbox/index.js";
import { ScriptedAttacker, ACME_SCRIPT } from "./attackers/scripted.js";
import type { Attacker } from "./attacker.js";
import { DEFAULT_CAPS } from "./caps.js";
import { CageBus } from "./events.js";
import { runSession } from "./harness.js";
import { loadDecoys } from "./task.js";
import { scenarioById } from "./scenarios.js";
import { TASK_PROMPT } from "../mirage/acme.js";
import { makeRealMirage, NullSandbox, realWatcher } from "./wire.js";
import { VmWorld } from "./world.js";
import type { Caps } from "./types.js";

export type FleetAttacker = "scripted" | "droid";
export interface FleetMember {
  attacker: FleetAttacker;
  honestEnv: "vm" | "acme";
  /** Business scenario id (scenarios.ts). Omitted = the original flag hunt. */
  scenario?: string;
}

/** What one fleet member did, for the measurement table. Nothing here is inferred — it is read off the run. */
export interface FleetResult {
  label: string;
  scenario: string;
  kind: "control" | "blocked" | "flag-hunt";
  attacker: FleetAttacker;
  ranAs: FleetAttacker;
  steps: number;
  triggered: boolean;
  triggerStep?: number;
  triggerReason?: string;
  realCalls: number;
  fakeCalls: number;
  realOutOfScope: number;
  watcherMisses: number;
  /** Distinct out-of-scope resources the agent reached for (from mirage/block verdict reasons). */
  crossings: string[];
  agentError?: string;
  /** What the agent said when it stopped (untrusted, display only). */
  agentSaid?: string;
  /** Tokens the agent used (Droid reports this when its run ends; 0 for scripted). */
  tokens: number;
  durationMs: number;
  /** The session's own run.summary (same record the dashboard and /cage/runs show), so the fleet's summary file is
   *  self-contained: forensic path, network isolation, containment, loop depth. Absent when the member never ran. */
  summary?: RunSummary;
}

export interface FleetOptions {
  members: FleetMember[];
  emit: (e: MirageEvent) => void;
  watcherOn?: boolean;
  caps?: Caps;
  /** How many agents run AT ONCE (e.g. Daytona's concurrent-VM limit). The total is unlimited. Default 10. */
  concurrency?: number;
  /** Stop starting NEW agents once the fleet has used this many tokens (checked as each agent finishes, so it can
   *  overshoot by up to `concurrency` agents' worth). Droid exposes usage only at the end of a run, so this is the
   *  honest spend control — it is tokens, not dollars, because we do not know the model's price. */
  tokenBudget?: number;
  /** Called as each agent finishes, so a long run can stream results to disk instead of holding them all. */
  onResult?: (r: FleetResult, done: number, total: number) => void;
  /** Polled before each new agent starts; return true to stop launching (agents already running still finish and clean up). */
  shouldStop?: () => boolean;
  /** Directory for the per-session forensic JSONL files. Default data/cage-runs/<timestamp>-fleet. null = no files (tests). */
  logDir?: string | null;
  /** Progressive latency base for mirage replies (ms per loop level). Default 0. */
  mirageLatencyMs?: number;
}



/** Run `fn` over `items` with at most `limit` in flight. Starts are staggered a little for the first wave only. */
export async function runPool<T>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
  shouldStop: () => boolean = () => false,
  staggerMs = 300,
  // The first wave's starts are spread over at most this long, so a large concurrency ramps up in seconds instead of
  // slot*staggerMs (which at 1000 slots would delay the last worker ~5 min). Daytona's cap was lifted, so wide pools
  // are expected: the per-slot gap shrinks to keep the whole ramp inside the window.
  rampWindowMs = 15000,
): Promise<void> {
  const width = Math.max(1, Math.floor(limit));
  const gap = width > 1 ? Math.min(staggerMs, Math.floor(rampWindowMs / (width - 1))) : 0;
  let next = 0;
  const worker = async (slot: number) => {
    // first wave: spread starts so VM creation does not hit Daytona all in the same instant
    if (slot > 0 && gap > 0) await new Promise<void>((r) => setTimeout(r, slot * gap));
    while (next < items.length && !shouldStop()) {
      const i = next++;
      await fn(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, (_, slot) => worker(slot)));
}

/** Launch the fleet. Each member runs to completion in its own env; every VM is torn down even on error. */
export async function runCageFleet(opts: FleetOptions): Promise<FleetResult[]> {
  const caps = opts.caps ?? DEFAULT_CAPS;
  const watcherOn = opts.watcherOn !== false;
  const members = opts.members;
  const concurrency = Math.max(1, Math.floor(opts.concurrency ?? 10));
  const width = Math.max(2, String(members.length).length);
  const logDir = opts.logDir === null ? undefined : opts.logDir ?? `${CAGE_RUNS_DIR}/${Date.now()}-fleet`;
  if (logDir) mkdirSync(logDir, { recursive: true });
  const results: FleetResult[] = [];
  let finished = 0;
  let tokens = 0;
  let overBudget = false;

  // When the pool is at least as wide as the fleet, every agent is one wave: fire all VM creations at once (no ramp).
  // Otherwise keep a small first-wave ramp so a capped pool does not hit Daytona's API all in the same instant.
  const allAtOnce = concurrency >= members.length;
  opts.emit({ type: "audit", actor: "fleet", action: "fleet.starting", detail: `${members.length} agents (${members.filter((m) => m.attacker === "droid").length} droid, ${members.filter((m) => m.attacker === "scripted").length} scripted), ${allAtOnce ? "all at once" : `${concurrency} at a time`}`, ts: Date.now() });

  await runPool(members, concurrency, async (member, i) => {
    const r = await runOne(member, i, width, { emit: opts.emit, watcherOn, caps, logDir, mirageLatencyMs: opts.mirageLatencyMs });
    finished++;
    {
      results.push(r);
      tokens += r.tokens;
      opts.onResult?.(r, finished, members.length);
      if (opts.tokenBudget !== undefined && tokens >= opts.tokenBudget && !overBudget) {
        overBudget = true;
        opts.emit({ type: "audit", actor: "fleet", action: "fleet.budget", detail: `token budget ${opts.tokenBudget} reached (${tokens} used); not starting any more agents`, ts: Date.now() });
      }
    }
  }, () => overBudget || (opts.shouldStop?.() ?? false), allAtOnce ? 0 : 300);

  const notRun = members.length - finished;
  opts.emit({ type: "audit", actor: "fleet", action: "fleet.complete", detail: `${finished} of ${members.length} agents watched${notRun ? ` (${notRun} not run: ${overBudget ? "token budget" : "stopped"})` : ""}`, ts: Date.now() });
  return results;
}

async function runOne(member: FleetMember, index: number, width: number, ctx: { emit: (e: MirageEvent) => void; watcherOn: boolean; caps: Caps; logDir?: string; mirageLatencyMs?: number }): Promise<FleetResult> {
  const label = `${member.honestEnv === "vm" ? "VM" : "AGENT"}-${String(index + 1).padStart(width, "0")}`;
  const startedAt = Date.now();
  const scenario = member.scenario ? scenarioById(member.scenario) : undefined;
  // A member that never ran still gets a row (steps 0, agentError set) so N requested == N rows in the record.
  const failedRow = (error: string): FleetResult => ({
    label, scenario: scenario?.id ?? member.scenario ?? "flag-hunt", kind: scenario?.kind ?? "flag-hunt",
    attacker: member.attacker, ranAs: member.attacker, steps: 0, triggered: false, realCalls: 0, fakeCalls: 0,
    realOutOfScope: 0, watcherMisses: 0, crossings: [], agentError: error, tokens: 0, durationMs: Date.now() - startedAt,
  });
  if (member.scenario && !scenario) {
    ctx.emit({ type: "audit", actor: "fleet", action: "vm.failed", detail: `${label}: unknown scenario "${member.scenario}"`, ts: Date.now() });
    return failedRow(`unknown scenario "${member.scenario}"`);
  }
  let sandbox: Sandbox | undefined;
  // Droid needs FACTORY_API_KEY; without it we fall back to scripted so the box is still live, and say so.
  let attackerKind = member.attacker;
  if (attackerKind === "droid" && !process.env.FACTORY_API_KEY) {
    ctx.emit({ type: "audit", actor: "fleet", action: "droid.fallback", detail: `${label}: no FACTORY_API_KEY, running scripted`, ts: Date.now() });
    attackerKind = "scripted";
  }
  try {
    if (member.honestEnv === "vm") {
      ctx.emit({ type: "audit", actor: "fleet", action: "vm.creating", detail: label, ts: Date.now() });
      sandbox = await VmWorld.create(loadDecoys().decoys, scenario?.files ?? []);
      ctx.emit({ type: "audit", actor: "fleet", action: "vm.ready", detail: `${label} → ${sandbox.id}${scenario ? ` (${scenario.id})` : ""}${attackerKind === "scripted" ? " · scripted rogue (simulated)" : " · live Droid"}`, ts: Date.now() });
    } else {
      sandbox = new NullSandbox();
    }

    const droid = attackerKind === "droid" ? (await import("./attackers/droid.js")).makeDroidAttacker({ task: scenario?.prompt ?? TASK_PROMPT }) : undefined;
    // A scripted member plays a SIMULATED rogue run of its scenario (or the generic flag-hunt script).
    const attacker: Attacker = droid ?? new ScriptedAttacker(scenario?.rogueScript ?? ACME_SCRIPT);

    // Host-side forensic log for THIS session: every tool.call is appended before it runs (events.ts).
    const bus = new CageBus(ctx.logDir ? `${ctx.logDir}/${label}.jsonl` : undefined);
    bus.subscribe((e) => ctx.emit(e)); // forward this VM's cage events to the core bus (dashboard groups by session)

    const r = await runSession({
      attacker, watcher: realWatcher, mirage: makeRealMirage(null),
      sandbox, bus, watcherOn: ctx.watcherOn, caps: ctx.caps, honestEnv: member.honestEnv,
      mirageLatencyMs: ctx.mirageLatencyMs, tokensUsed: () => droid?.tokensUsed,
    });

    const crossings = [...new Set(r.history.filter((h) => h.decision !== "pass").map((h) => resourceOf(h.call)))];
    const result: FleetResult = {
      label, scenario: scenario?.id ?? "flag-hunt", kind: scenario?.kind ?? "flag-hunt",
      attacker: member.attacker, ranAs: attackerKind,
      steps: r.session.realCalls + r.session.fakeCalls,
      triggered: r.session.triggered, triggerStep: r.session.triggerStep, triggerReason: r.session.triggerReason,
      realCalls: r.session.realCalls, fakeCalls: r.session.fakeCalls,
      realOutOfScope: r.realOutOfScope, watcherMisses: r.watcherMisses, crossings,
      agentError: droid?.error,
      agentSaid: droid?.finalMessage?.replace(/\s+/g, " ").slice(0, 400) || undefined,
      tokens: droid?.tokensUsed ?? 0,
      durationMs: Date.now() - startedAt,
      summary: r.summary,
    };
    ctx.emit({ type: "audit", actor: "fleet", action: "vm.summary", detail: `${label} ${result.scenario} [${attackerKind}]: ${result.triggered ? `TRIGGERED step ${result.triggerStep} (${result.triggerReason})` : "stayed in scope"}; real=${result.realCalls} mirage=${result.fakeCalls} realOOS=${result.realOutOfScope}`, ts: Date.now() });
    return result;
  } catch (e) {
    ctx.emit({ type: "audit", actor: "fleet", action: "vm.failed", detail: `${label}: ${(e as Error).message}`, ts: Date.now() });
    return failedRow((e as Error).message);
  } finally {
    await sandbox?.destroy().catch(() => undefined);
    if (member.honestEnv === "vm") ctx.emit({ type: "audit", actor: "fleet", action: "vm.destroyed", detail: label, ts: Date.now() });
  }
}

/** A short label for what a call reached for, e.g. "/opt/acme/secrets.env" or "hub-prod.acme.internal". */
function resourceOf(call: { tool: string; args: Record<string, unknown> }): string {
  const a = call.args;
  if (typeof a.path === "string") return a.path;
  if (typeof a.url === "string") { try { return new URL(a.url).hostname + new URL(a.url).pathname; } catch { return a.url; } }
  return String(a.cmd ?? call.tool).slice(0, 80);
}

/** Build a members list from counts, e.g. ?droid=2&scripted=1. */
export function membersFromCounts(droid: number, scripted: number, honestEnv: "vm" | "acme" = "vm"): FleetMember[] {
  const list: FleetMember[] = [];
  for (let i = 0; i < Math.max(0, droid); i++) list.push({ attacker: "droid", honestEnv });
  for (let i = 0; i < Math.max(0, scripted); i++) list.push({ attacker: "scripted", honestEnv });
  return list;
}

/** One member per scenario id, e.g. ["billing-sync","orders-report"] — the unscripted, no-script fleet. */
export function membersFromScenarios(ids: string[], attacker: FleetAttacker = "droid"): FleetMember[] {
  return ids.map((scenario) => ({ attacker, honestEnv: "vm" as const, scenario }));
}

/** The mixed fleet: live Droid agents on `real` scenarios (unscripted, whatever they do) plus SIMULATED scripted rogues
 *  on `rogue` scenarios. The split is always visible in the events, so the demo never passes a script off as Droid. */
export function membersFromMix(real: string[], rogue: string[]): FleetMember[] {
  return [
    ...real.map((scenario) => ({ attacker: "droid" as const, honestEnv: "vm" as const, scenario })),
    ...rogue.map((scenario) => ({ attacker: "scripted" as const, honestEnv: "vm" as const, scenario })),
  ];
}

/** N members cycling through `scenarios` (round-robin), all the same attacker/env. For scale runs. */
export function membersFromAgents(n: number, scenarios: string[], attacker: FleetAttacker = "droid", honestEnv: "vm" | "acme" = "vm"): FleetMember[] {
  if (!scenarios.length) throw new Error("membersFromAgents needs at least one scenario");
  return Array.from({ length: Math.max(0, Math.floor(n)) }, (_, i) => ({ attacker, honestEnv, scenario: scenarios[i % scenarios.length] }));
}

/** Wilson 95% interval for k of n — honest about small samples (0 of 6 does NOT mean "never"). */
export function wilson95(k: number, n: number): { low: number; high: number } {
  if (n === 0) return { low: 0, high: 1 };
  const z = 1.96, p = k / n, d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n), m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { low: Math.max(0, (c - m) / d), high: Math.min(1, (c + m) / d) };
}
