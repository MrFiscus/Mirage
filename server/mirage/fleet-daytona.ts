// Real-VM fleet: N scripted agents, each in its OWN Daytona sandbox, all watched by the one real
// watcher. Composes Person A's cage runSession with DaytonaSandbox and forwards each agent's
// MirageEvents to the core bus (so the dashboard renders them). Honest: every box IS a real VM.
//
// This is the "Option C" path. The in-process session fleet (mock.runFleet) stays as the fallback.
import type { MirageEvent } from "../../shared/types.js";
import { emit } from "../core/events.js";
import { DaytonaSandbox } from "../defense/sandbox/daytona.js";
import { ScriptedAttacker } from "../cage/attackers/scripted.js";
import { CageBus } from "../cage/events.js";
import { runSession } from "../cage/harness.js";
import { makeRealMirage, realWatcher } from "../cage/wire.js";

async function runOneVm(index: number): Promise<void> {
  const label = `VM-${String(index + 1).padStart(2, "0")}`;
  let sandbox: DaytonaSandbox | undefined;
  try {
    emit({ type: "audit", actor: "fleet", action: "vm.creating", detail: label, ts: Date.now() });
    sandbox = await DaytonaSandbox.create();
    const bus = new CageBus();
    bus.subscribe((e) => emit(e)); // forward every cage MirageEvent to the dashboard
    emit({ type: "audit", actor: "fleet", action: "vm.ready", detail: `${label} → ${sandbox.id}`, ts: Date.now() });
    await runSession({
      attacker: new ScriptedAttacker(),
      watcher: realWatcher,
      mirage: makeRealMirage(null),
      sandbox,
      bus,
      watcherOn: true,
      honestEnv: "sandbox",
    });
  } catch (e) {
    emit({ type: "audit", actor: "fleet", action: "vm.failed", detail: `${label}: ${(e as Error).message}`, ts: Date.now() });
  } finally {
    await sandbox?.destroy().catch(() => undefined);
    emit({ type: "audit", actor: "fleet", action: "vm.destroyed", detail: label, ts: Date.now() });
  }
}

/** Launch N real Daytona VMs concurrently, each running a watched scripted agent. */
export async function runFleetDaytona(n = 6): Promise<void> {
  const count = Math.max(1, Math.min(10, n));
  emit({ type: "audit", actor: "fleet", action: "fleet.starting", detail: `${count} real Daytona VMs`, ts: Date.now() });
  // Small stagger so sandbox creation does not all hit Daytona in the exact same instant.
  const runs = Array.from({ length: count }, (_, i) => new Promise<void>((r) => setTimeout(r, i * 250)).then(() => runOneVm(i)));
  await Promise.all(runs);
  emit({ type: "audit", actor: "fleet", action: "fleet.complete", detail: `${count} real VMs`, ts: Date.now() } as MirageEvent);
}
