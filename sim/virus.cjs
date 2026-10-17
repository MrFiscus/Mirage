// SIMULATED, HARMLESS "virus" for the Batman demo. Run with cwd = a sandbox app dir.
// It never touches the network: the "beacon" is just a line written to a log file.
const fs = require("fs");
const cp = require("child_process");
const TAG = process.env.BATMAN_SANDBOX_ID || "local";

function spawnRogue() {
  fs.mkdirSync(".run", { recursive: true });
  const c = cp.spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", "rogue-miner-" + TAG], { detached: true, stdio: "ignore" });
  c.unref();
  fs.writeFileSync(".run/rogue.pid", String(c.pid));
}

const mode = process.argv[2] || "inject";
if (mode === "low") {
  // Low tier: an unapproved scheduled task appears. No process, no network, no file changes.
  fs.mkdirSync("cron", { recursive: true });
  fs.writeFileSync("cron/updater.cron", "0 3 * * * /tmp/updater.sh # simulated, never executed\n");
} else if (mode === "respawn") {
  spawnRogue();
} else {
  spawnRogue();
  fs.appendFileSync("lib.cjs", "\n// SIMULATED-VIRUS-MARKER\n");
  fs.mkdirSync("logs", { recursive: true });
  fs.appendFileSync("logs/network.log", new Date().toISOString() + " OUTBOUND tcp 10.0.0.99:4444 beacon host=acme-payroll-01\n");
  fs.mkdirSync("cron", { recursive: true });
  fs.writeFileSync("cron/beacon.cron", "*/5 * * * * beacon 10.0.0.99:4444 # simulated, never executed\n");
}
