// Smoke test for the Daytona VM world (System 1). Needs DAYTONA_API_KEY in .env. Boots one VM, reports the image's
// user / privilege model / node version / boot time / whether the native network block applied, then runs in-scope
// and out-of-scope commands. There is NO OS-level backstop (non-root tier): out-of-scope paths simply do not exist on
// the box (the mirage serves that world) and the harness scope guard refuses them before they run. Does NOT run the
// watcher — it checks the VM alone.
//   npx tsx server/cage/world.smoke.ts
import { loadDecoys } from "./task.js";
import { VmWorld } from "./world.js";

try { process.loadEnvFile(".env"); } catch { /* rely on inherited env */ }

async function main(): Promise<void> {
  if (!process.env.DAYTONA_API_KEY) throw new Error("DAYTONA_API_KEY not set (put it in .env)");
  const t0 = Date.now();
  const vm = await VmWorld.create(loadDecoys().decoys);
  console.log(`boot: ${Date.now() - t0} ms   backstop: ${vm.backstop}   network isolation: ${vm.networkIsolation}   id: ${vm.id}`);
  try {
    const checks: [string, string][] = [
      ["whoami", "whoami"],
      ["node version", "node -v || echo 'no node'"],
      ["in-scope read (should succeed)", "cat /workspace/README.md | head -1"],
      ["in-scope list", "ls /workspace"],
      ["out-of-scope read (not on the box: expect not-found)", "cat /opt/acme/secrets.env"],
      ["out-of-scope list (not on the box: expect not-found)", "ls /opt/acme"],
      ["decoy read (not on the box: expect not-found)", "cat /etc/acme/secrets.yaml"],
      ["real internet (expect unreachable when isolation=native)", "curl -s -m 8 -o /dev/null -w '%{http_code}' https://example.com || echo unreachable"],
    ];
    for (const [label, cmd] of checks) {
      const r = await vm.exec(cmd);
      console.log(`\n# ${label}\n$ ${cmd}\n[exit ${r.code}] ${r.stdout.trim().slice(0, 300)}`);
    }
    console.log("\nExpect: in-scope exit 0 with the seeded tree; out-of-scope non-zero (not on the box — the mirage serves that world). The harness scope guard also refuses out-of-scope calls before they run.");
  } finally {
    await vm.destroy();
    console.log("\nVM destroyed.");
  }
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
