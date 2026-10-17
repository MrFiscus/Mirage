import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { cp, lstat, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExecResult, Sandbox } from "./types.js";

const SIM_DIR = fileURLToPath(new URL("../../../sim", import.meta.url));
const KEY_FILES = ["lib.cjs", "config.json", "server.cjs"];

export const VIRUS_PATH = join(SIM_DIR, "virus.cjs");
export const AGENT_PATH = join(SIM_DIR, "agent.cjs");

/** Which simulated processes are alive on a machine, so a clone can re-create them under its own id. */
export const LIVE_QUERY = '{ test -f .run/sink.pid && echo sink; ps -eo args | grep -q "[a]gent-keepalive-$BATMAN_SANDBOX_ID" && echo keepalive; } || true';
export const respawnArgs = (live: string) => live.split("\n").map((s) => s.trim()).filter((s) => s === "sink" || s === "keepalive");

export class LocalSandbox implements Sandbox {
  private constructor(readonly id: string, readonly dir: string) {}

  /** Fresh "company machine": a temp copy of sim/app plus a trusted baseline of key files. */
  static async create(): Promise<LocalSandbox> {
    const id = randomBytes(4).toString("hex");
    const root = await mkdtemp(join(tmpdir(), "batman-"));
    const dir = join(root, "app");
    await cp(join(SIM_DIR, "app"), dir, { recursive: true });
    await mkdir(join(dir, ".baseline"), { recursive: true });
    const hashes: Record<string, string> = {};
    for (const f of KEY_FILES) {
      const buf = await readFile(join(dir, f));
      hashes[f] = createHash("sha256").update(buf).digest("hex");
      await writeFile(join(dir, ".baseline", f), buf);
    }
    await writeFile(join(dir, ".baseline", "hashes.json"), JSON.stringify(hashes));
    return new LocalSandbox(id, dir);
  }

  exec(command: string, timeoutMs = 30_000): Promise<ExecResult> {
    return new Promise((res) => {
      const c = spawn("sh", ["-c", command], {
        cwd: this.dir,
        env: { ...process.env, BATMAN_SANDBOX_ID: this.id },
      });
      let stdout = "", stderr = "";
      const timer = setTimeout(() => c.kill("SIGKILL"), timeoutMs);
      c.stdout.on("data", (d) => (stdout += d));
      c.stderr.on("data", (d) => (stderr += d));
      let done = false;
      const finish = (r: ExecResult) => { if (!done) { done = true; clearTimeout(timer); res(r); } };
      // Without this, a missing shell (e.g. no `sh` on Windows) would leave the promise pending forever.
      c.on("error", (err) => finish({ code: -1, stdout, stderr: stderr + String(err) }));
      c.on("close", (code) => finish({ code: code ?? -1, stdout, stderr }));
    });
  }

  runScript(localPath: string, args = ""): Promise<ExecResult> {
    return this.exec(`node "${localPath}" ${args}`);
  }

  async readFile(path: string): Promise<string> {
    const full = resolve(this.dir, path);
    if (full !== this.dir && !full.startsWith(this.dir + sep)) throw new Error("path escapes sandbox");
    return readFile(full, "utf8");
  }

  /** Copy files; re-create any running rogue process under the clone's own id so fixes never touch the original. */
  async clone(): Promise<LocalSandbox> {
    const id = randomBytes(4).toString("hex");
    const root = await mkdtemp(join(tmpdir(), "batman-"));
    const dir = join(root, "app");
    // Skip the decoy sensor's Unix sockets: fs.cp cannot copy them, and the respawned sink re-creates its own.
    await cp(this.dir, dir, { recursive: true, filter: async (src) => !(await lstat(src)).isSocket() });
    const copy = new LocalSandbox(id, dir);
    if (existsSync(join(this.dir, ".run", "rogue.pid"))) {
      await rm(join(dir, ".run", "rogue.pid"), { force: true });
      await copy.runScript(VIRUS_PATH, "respawn");
    }
    const agentProcs = respawnArgs((await this.exec(LIVE_QUERY)).stdout);
    if (agentProcs.length) await copy.runScript(AGENT_PATH, `respawn ${agentProcs.join(" ")}`);
    return copy;
  }

  async destroy(): Promise<void> {
    for (const f of ["rogue.pid", "sink.pid"]) {
      try {
        const pid = Number(readFileSync(join(this.dir, ".run", f), "utf8"));
        if (pid) process.kill(pid);
      } catch { /* no process */ }
    }
    await this.exec('pkill -f "[a]gent-keepalive-$BATMAN_SANDBOX_ID" || true');
    await rm(resolve(this.dir, ".."), { recursive: true, force: true });
  }
}
