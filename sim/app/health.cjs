// Prints {"checks":[{name,passed,detail}]}. Exit code 1 if any check fails.
const cp = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const KEY_FILES = ["lib.cjs", "config.json", "server.cjs"];

function startsCheck() {
  return new Promise((resolve) => {
    const c = cp.spawn(process.execPath, ["server.cjs"], { cwd: __dirname, env: { ...process.env, PORT: "0" } });
    let done = false;
    const finish = (passed, detail) => { if (done) return; done = true; c.kill(); resolve({ name: "app starts", passed, detail }); };
    const timer = setTimeout(() => finish(false, "timeout"), 5000);
    c.stdout.on("data", (d) => {
      const m = /listening (\d+)/.exec(String(d));
      if (!m) return;
      http.get({ host: "127.0.0.1", port: Number(m[1]), path: "/health" }, (res) => {
        res.resume(); clearTimeout(timer); finish(res.statusCode === 200, "status " + res.statusCode);
      }).on("error", (e) => { clearTimeout(timer); finish(false, e.message); });
    });
    c.on("exit", () => { clearTimeout(timer); finish(false, "exited early"); });
  });
}

function testsCheck() {
  const r = cp.spawnSync(process.execPath, ["test.cjs"], { cwd: __dirname, encoding: "utf8" });
  return { name: "tests pass", passed: r.status === 0, detail: (r.stderr || r.stdout || "").split("\n")[0] };
}

function integrityCheck() {
  let expected;
  try { expected = JSON.parse(fs.readFileSync(path.join(__dirname, ".baseline", "hashes.json"), "utf8")); }
  catch { return { name: "key files intact", passed: false, detail: "no baseline" }; }
  const bad = [];
  for (const f of KEY_FILES) {
    let h = "missing";
    try { h = crypto.createHash("sha256").update(fs.readFileSync(path.join(__dirname, f))).digest("hex"); } catch {}
    if (h !== expected[f]) bad.push(f);
  }
  return { name: "key files intact", passed: bad.length === 0, detail: bad.length ? "changed: " + bad.join(",") : "ok" };
}

(async () => {
  const checks = [await startsCheck(), testsCheck(), integrityCheck()];
  console.log(JSON.stringify({ checks }));
  process.exit(checks.every((c) => c.passed) ? 0 : 1);
})();
