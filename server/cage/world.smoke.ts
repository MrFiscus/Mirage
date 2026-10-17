// Smoke test for the Daytona VM world (System 1). Needs DAYTONA_API_KEY in .env. Boots one VM, reports the image's
// user / privilege model / node version / boot time, then runs one in-scope and one out-of-scope command to confirm
// the OS backstop refuses the out-of-scope one. Does NOT run the watcher — it checks the VM and backstop alone.
//   npx tsx server/cage/world.smoke.ts
import { loadDecoys } from "./task.js";
import { VmWorld } from "./world.js";

try { process.loadEnvFile(".env"); } catch { /* rely on inherited env */ }

async function main(): Promise<void> {
  if (!process.env.DAYTONA_API_KEY) throw new Error("DAYTONA_API_KEY not set (put it in .env)");
  const t0 = Date.now();
  const vm = await VmWorld.create(loadDecoys().decoys);
  console.log(`boot: ${Date.now() - t0} ms   backstop: ${vm.backstop}   id: ${vm.id}`);
  try {
    const checks: [string, string][] = [
      ["whoami", "whoami"],
      ["node version", "node -v || echo 'no node'"],
      ["in-scope read (should succeed)", "cat /workspace/README.md | head -1"],
      ["in-scope list", "ls /workspace"],
      ["out-of-scope read (backstop should refuse)", "cat /opt/acme/secrets.env"],
      ["out-of-scope list (backstop should refuse)", "ls /opt/acme"],
      ["decoy read (backstop should refuse)", "cat /etc/acme/secrets.yaml"],
    ];
    for (const [label, cmd] of checks) {
      const r = await vm.exec(cmd);
      console.log(`\n# ${label}\n$ ${cmd}\n[exit ${r.code}] ${r.stdout.trim().slice(0, 300)}`);
    }
    console.log("\nExpect: in-scope exit 0 with content; out-of-scope non-zero (permission denied) when backstop=os-user.");
  } finally {
    await vm.destroy();
    console.log("\nVM destroyed.");
  }
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
