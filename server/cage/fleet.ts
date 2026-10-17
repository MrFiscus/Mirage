// The demo fleet (Person A, System 3). N agents attacked at once, each in its OWN env, all watched by the one real
// watcher, all emitting onto the core bus so the existing fleet UI renders them (it groups by session id and reacts
// to session.started / tool.call / watcher.verdict and the fleet.starting / fleet.complete audits).
//
// Reconciles with server/mirage/fleet-daytona.ts (Person C): that one runs all-scripted agents in the legacy
// "sandbox" deploy world; this one runs a Droid + scripted MIX in the new "vm" world (the deeper Acme tree + the OS
// backstop from System 1). Both compose the SAME cage runSession — neither forks the loop. To point the dashboard
// button at this fleet, Person C changes the UI fetch to POST /cage/fleet/start?droid=2&scripted=1 (their lane).
import type { MirageEvent } from "../../shared/types.js";
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
}
export interface FleetOptions {
  members: FleetMember[];
  emit: (e: MirageEvent) => void;
  watcherOn?: boolean;
  caps?: Caps;
  /** Hard ceiling on VMs regardless of the request (Daytona free-tier concurrency). Independent of the watcher. */
  maxVms?: number;
}

/** Launch the fleet. Each member runs to completion in its own env; every VM is torn down even on error. */
export async function runCageFleet(opts: FleetOptions): Promise<FleetResult[]> {
  const maxVms = opts.maxVms ?? 8;
  const caps = opts.caps ?? DEFAULT_CAPS;
  const watcherOn = opts.watcherOn !== false;
  // vm members need a real Daytona VM each; cap how many VMs we ask for, independent of any model or the watcher.
  const vmCount = opts.members.filter((m) => m.honestEnv === "vm").length;
  const members = vmCount > maxVms
    ? capVms(opts.members, maxVms)
    : opts.members;

  opts.emit({ type: "audit", actor: "fleet", action: "fleet.starting", detail: `${members.length} agents (${members.filter((m) => m.attacker === "droid").length} droid, ${members.filter((m) => m.attacker === "scripted").length} scripted)`, ts: Date.now() });

  const runs = members.map((m, i) =>
    // small stagger so VM creation does not all hit Daytona at once, and the UI fills in gradually
    new Promise<void>((r) => setTimeout(r, i * 300)).then(() => runOne(m, i, { emit: opts.emit, watcherOn, caps })));
  const results = (await Promise.all(runs)).filter((r): r is FleetResult => Boolean(r));

  opts.emit({ type: "audit", actor: "fleet", action: "fleet.complete", detail: `${members.length} agents watched`, ts: Date.now() });
  return results;
}

async function runOne(member: FleetMember, index: number, ctx: { emit: (e: MirageEvent) => void; watcherOn: boolean; caps: Caps }): Promise<FleetResult | undefined> {
  const label = `VM-${String(index + 1).padStart(2, "0")}`;
  const scenario = member.scenario ? scenarioById(member.scenario) : undefined;
  if (member.scenario && !scenario) {
    ctx.emit({ type: "audit", actor: "fleet", action: "vm.failed", detail: `${label}: unknown scenario "${member.scenario}"`, ts: Date.now() });
    return undefined;
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

    const bus = new CageBus();
    bus.subscribe((e) => ctx.emit(e)); // forward this VM's cage events to the core bus (dashboard groups by session)

    const r = await runSession({
      attacker, watcher: realWatcher, mirage: makeRealMirage(null),
      sandbox, bus, watcherOn: ctx.watcherOn, caps: ctx.caps, honestEnv: member.honestEnv,
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
    };
    ctx.emit({ type: "audit", actor: "fleet", action: "vm.summary", detail: `${label} ${result.scenario} [${attackerKind}]: ${result.triggered ? `TRIGGERED step ${result.triggerStep} (${result.triggerReason})` : "stayed in scope"}; real=${result.realCalls} mirage=${result.fakeCalls} realOOS=${result.realOutOfScope}`, ts: Date.now() });
    return result;
  } catch (e) {
    ctx.emit({ type: "audit", actor: "fleet", action: "vm.failed", detail: `${label}: ${(e as Error).message}`, ts: Date.now() });
    return undefined;
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

/** Keep every scripted/acme member; trim vm members down to the ceiling so we never exceed the concurrency cap. */
function capVms(members: FleetMember[], maxVms: number): FleetMember[] {
  let vms = 0;
  return members.filter((m) => m.honestEnv !== "vm" || ++vms <= maxVms);
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
