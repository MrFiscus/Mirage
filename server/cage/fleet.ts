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
import { TASK_PROMPT } from "../mirage/acme.js";
import { makeRealMirage, NullSandbox, realWatcher } from "./wire.js";
import { VmWorld } from "./world.js";
import type { Caps } from "./types.js";

export type FleetAttacker = "scripted" | "droid";
export interface FleetMember { attacker: FleetAttacker; honestEnv: "vm" | "acme" }
export interface FleetOptions {
  members: FleetMember[];
  emit: (e: MirageEvent) => void;
  watcherOn?: boolean;
  caps?: Caps;
  /** Hard ceiling on VMs regardless of the request (Daytona free-tier concurrency). Independent of the watcher. */
  maxVms?: number;
}

/** Launch the fleet. Each member runs to completion in its own env; every VM is torn down even on error. */
export async function runCageFleet(opts: FleetOptions): Promise<void> {
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
  await Promise.all(runs);

  opts.emit({ type: "audit", actor: "fleet", action: "fleet.complete", detail: `${members.length} agents watched`, ts: Date.now() });
}

async function runOne(member: FleetMember, index: number, ctx: { emit: (e: MirageEvent) => void; watcherOn: boolean; caps: Caps }): Promise<void> {
  const label = `VM-${String(index + 1).padStart(2, "0")}`;
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
      sandbox = await VmWorld.create(loadDecoys().decoys);
      ctx.emit({ type: "audit", actor: "fleet", action: "vm.ready", detail: `${label} → ${sandbox.id} (backstop ${(sandbox as VmWorld).backstop})`, ts: Date.now() });
    } else {
      sandbox = new NullSandbox();
    }

    const attacker: Attacker = attackerKind === "droid"
      ? (await import("./attackers/droid.js")).makeDroidAttacker({ task: TASK_PROMPT })
      : new ScriptedAttacker(ACME_SCRIPT);

    const bus = new CageBus();
    bus.subscribe((e) => ctx.emit(e)); // forward this VM's cage events to the core bus (dashboard groups by session)

    await runSession({
      attacker, watcher: realWatcher, mirage: makeRealMirage(null),
      sandbox, bus, watcherOn: ctx.watcherOn, caps: ctx.caps, honestEnv: member.honestEnv,
    });
  } catch (e) {
    ctx.emit({ type: "audit", actor: "fleet", action: "vm.failed", detail: `${label}: ${(e as Error).message}`, ts: Date.now() });
  } finally {
    await sandbox?.destroy().catch(() => undefined);
    if (member.honestEnv === "vm") ctx.emit({ type: "audit", actor: "fleet", action: "vm.destroyed", detail: label, ts: Date.now() });
  }
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
