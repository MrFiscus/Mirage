// Turns a POST /cage/fleet/start query into a fleet (Person A). Pure — no express, no I/O — so the route stays thin and
// every form is unit tested. Three dashboard modes, plus the older forms kept working:
//   ?mode=live&n=N      N live Droid agents on the impossible flag hunt (eval-rerun). Nothing scripted.
//   ?mode=mixed&n=N     ceil(N/2) live Droid on the blocked jobs + floor(N/2) SIMULATED scripted rogues.
//   ?mode=scripted&n=N  N scripted rogue runs on real VMs. Simulated behaviour; needs no FACTORY_API_KEY.
//   ?live=N | ?real=a,b&rogue=c,d | ?droid=2&scripted=1   (legacy)
// Live modes refuse without FACTORY_API_KEY rather than quietly running scripts in Droid's place.
import { membersFromCounts, membersFromMix, type FleetMember } from "./fleet.js";
import { SCENARIOS } from "./scenarios.js";

export type FleetMode = "live" | "mixed" | "scripted";
export const FLEET_MODES: readonly FleetMode[] = ["live", "mixed", "scripted"];

/** Jobs that cannot be finished in scope (billing-sync, hotfix-deploy, eval-rerun) — the live Droid half of "mixed". */
export const BLOCKED_SCENARIOS = SCENARIOS.filter((s) => s.kind === "blocked").map((s) => s.id);
/** Jobs that carry a rogueScript (billing-sync, hotfix-deploy) — what a SIMULATED scripted rogue replays. */
export const ROGUE_SCENARIOS = SCENARIOS.filter((s) => s.rogueScript?.length).map((s) => s.id);

/** Above this many agents the server refuses while texts/calls are live: the notifier alerts once per tripped session. */
export const NOTIFIER_LIVE_MAX_AGENTS = 25;

export interface FleetEnv { FACTORY_API_KEY?: string; PHOTON_MODE?: string; VOICE_MODE?: string }

export interface ConcurrencyEnv {
  FACTORY_API_KEY?: string;
  CAGE_CPU_BUDGET?: string; CAGE_VCPU_PER_VM?: string;
  CAGE_MAX_LIVE_DROID?: string; CAGE_MAX_VMS?: string;
}

/** How many agents the fleet runs AT ONCE. Two different real limits:
 *  - SCRIPTED agents run in-process → bounded by Daytona's CPU budget (CAGE_CPU_BUDGET / CAGE_VCPU_PER_VM, ~60 on Tier 3).
 *  - LIVE DROID agents each spawn a local CLI subprocess + MCP server → bounded by THIS machine's RAM (CAGE_MAX_LIVE_DROID,
 *    default 8); too many OOM-kill the server. So any fleet containing live Droid defaults to the small local cap.
 *  ?concurrency=N overrides either; CAGE_MAX_VMS overrides the scripted-only default. Never below 1 or above the fleet. */
export function chooseConcurrency(members: FleetMember[], query: Record<string, unknown>, env: ConcurrencyEnv): number {
  const int = (v: unknown) => Math.floor(Number(v));
  const cpuBudget = int(env.CAGE_CPU_BUDGET) || 250;
  const vcpuPerVm = Math.max(1, int(env.CAGE_VCPU_PER_VM) || 4);
  const scriptedDefault = Math.max(1, Math.floor(cpuBudget / vcpuPerVm) - 2);
  const liveDroidCap = Math.max(1, int(env.CAGE_MAX_LIVE_DROID) || 8);
  const envCap = int(env.CAGE_MAX_VMS);

  const hasLiveDroid = members.some((m) => m.attacker === "droid") && !!env.FACTORY_API_KEY;
  const scripted = Number.isFinite(envCap) && envCap > 0 ? envCap : scriptedDefault;
  const defaultConcurrency = hasLiveDroid ? liveDroidCap : scripted;

  const requested = int(query.concurrency);
  const chosen = requested > 0 ? requested : defaultConcurrency;
  return Math.max(1, Math.min(chosen, members.length));
}
export type FleetPlan =
  | { ok: true; mode: FleetMode | "legacy"; members: FleetMember[] }
  | { ok: false; status: 400 | 409 | 503; error: string };

/** How many live / simulated agents a mode yields for N. The console mirrors this to label the preview. */
export function modeSplit(mode: FleetMode, n: number): { live: number; simulated: number } {
  if (mode === "live") return { live: n, simulated: 0 };
  if (mode === "scripted") return { live: 0, simulated: n };
  return { live: Math.ceil(n / 2), simulated: Math.floor(n / 2) };
}

const cycle = (ids: string[], n: number) => Array.from({ length: n }, (_, i) => ids[i % ids.length]);
const list = (v: unknown) => String(v ?? "").split(",").map((x) => x.trim()).filter(Boolean);
const NO_KEY = "FACTORY_API_KEY is not set; live Droid agents cannot start. Pick \"Fully scripted\" to run simulated rogues instead.";

/** Alternate two lists (a0 b0 a1 b1 ...) so a mixed fleet larger than the VM limit starts both kinds early. */
function alternate<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

function positiveWhole(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isSafeInteger(n) && n >= 1 ? n : undefined;
}

export function planFleet(query: Record<string, unknown>, env: FleetEnv): FleetPlan {
  let mode: FleetMode | "legacy";
  let members: FleetMember[];

  if (query.mode !== undefined) {
    const asked = String(query.mode);
    if (!(FLEET_MODES as readonly string[]).includes(asked)) return { ok: false, status: 400, error: `mode must be one of ${FLEET_MODES.join(", ")}` };
    const n = positiveWhole(query.n);
    if (n === undefined) return { ok: false, status: 400, error: "n must be a positive whole number" };
    mode = asked as FleetMode;
    const split = modeSplit(mode, n);
    if (split.live > 0 && !env.FACTORY_API_KEY) return { ok: false, status: 503, error: NO_KEY };
    if (mode === "live") members = membersFromMix(cycle(["eval-rerun"], n), []);
    else if (mode === "scripted") members = membersFromMix([], cycle(ROGUE_SCENARIOS, n));
    else {
      const mixed = membersFromMix(cycle(BLOCKED_SCENARIOS, split.live), cycle(ROGUE_SCENARIOS, split.simulated));
      members = alternate(mixed.filter((m) => m.attacker === "droid"), mixed.filter((m) => m.attacker === "scripted"));
    }
  } else if (query.live !== undefined) {
    // Legacy dashboard form: ?live=N -> N live Droid agents on the flag hunt.
    if (!env.FACTORY_API_KEY) return { ok: false, status: 503, error: NO_KEY };
    const n = positiveWhole(query.live);
    if (n === undefined) return { ok: false, status: 400, error: "live must be a positive whole number" };
    mode = "legacy";
    members = membersFromMix(cycle(["eval-rerun"], n), []);
  } else {
    // Legacy mixed forms: ?real=a,b&rogue=c,d, else the counts form ?droid=2&scripted=1. Here a Droid member with no
    // key still falls back to scripted inside the fleet (it emits droid.fallback and the session says "scripted").
    const real = list(query.real);
    const rogue = list(query.rogue);
    mode = "legacy";
    members = real.length || rogue.length
      ? membersFromMix(real, rogue)
      : membersFromCounts(Number(query.droid ?? 2), Number(query.scripted ?? 1), "vm");
  }

  // A fleet through the server shares the event bus with the analyst notifier, which fires once per tripped SESSION.
  // With live texts/calls on, N tripped agents could mean N real messages to the on-call phone. Large runs belong on
  // the CLI (`npm run cage:fleet -- --agents N`), which never touches the notifier.
  const notifierLive = env.PHOTON_MODE === "live" || env.VOICE_MODE === "live";
  if (members.length > NOTIFIER_LIVE_MAX_AGENTS && notifierLive) {
    return { ok: false, status: 409, error: `Refusing ${members.length} agents through the server while PHOTON_MODE/VOICE_MODE is live (one analyst alert per tripped agent). Run it with the CLI, or set both to mock.` };
  }
  return { ok: true, mode, members };
}
