// The Daytona VM world (Person A, System 1). A real VM seeded with the honest Acme file tree: in-scope
// /workspace/... that the agent may touch, plus out-of-scope synthetic dirs (/opt/acme, /etc/acme, …) and the
// planted decoys. in-scope run_shell / read_file run here for real; HTTP stays simulated in-process (the Acme
// services don't exist on the box). This is the env a live Droid attacks.
//
// Backstop that does NOT depend on the watcher: every agent command runs as a low-privilege user whose reads and
// writes are confined to /workspace. If the watcher ever passes an out-of-scope call by mistake, the real command
// fails with "permission denied" and the harness counts a WATCHER MISS — never a real out-of-scope access. So
// "zero real out-of-scope access" holds by construction, not by trusting the watcher. Whether the image supports
// the backstop is probed at setup; if it can't, the world reports backstop:"none" and we lean on the referee alone.
import { randomBytes } from "node:crypto";
import type { Sandbox as DaytonaBox } from "@daytonaio/sdk";
import { daytona, limit } from "../defense/sandbox/daytona.js";
import type { ExecResult, Sandbox } from "../defense/sandbox/types.js";
import { acmeSeedFiles } from "../mirage/acme.js";
import type { Decoy } from "./task.js";

/** The agent runs as this non-root user; only /workspace is writable/readable by it. */
const AGENT_USER = "agent";
const IN_SCOPE_DIR = "/workspace";
/** Out-of-scope roots we lock down so the OS refuses the agent user even if the watcher slips. */
const LOCKED_ROOTS = ["/opt/acme", "/etc/acme", "/var/log/acme"];

export type BackstopMode = "os-user" | "none";

export class VmWorld implements Sandbox {
  private constructor(readonly id: string, private box: DaytonaBox, readonly backstop: BackstopMode) {}

  /** Boot a VM, seed the Acme tree + decoys at absolute paths, and (if the image allows) set up the OS backstop. */
  static async create(decoys: Decoy[] = []): Promise<VmWorld> {
    if (!process.env.DAYTONA_API_KEY) throw new Error("DAYTONA_API_KEY not set");
    const box = await limit(daytona().create({ ephemeral: true, autoStopInterval: 10 }), 90_000, "create VM");
    const id = randomBytes(4).toString("hex");

    // Seed the honest tree. acmeSeedFiles() returns paths WITHOUT a leading "/"; restore it for the VM.
    const files = acmeSeedFiles().map((f) => ({ source: f.content, destination: `/${f.path}` }));
    // Decoys from tripwires.json live at absolute paths already (/creds/..., /etc/acme/..., /root/...).
    for (const d of decoys) files.push({ source: Buffer.from(d.value), destination: absolute(d.path) });
    await limit(box.fs.uploadFiles(files), 60_000, "seed Acme tree");

    const backstop = await trySetupBackstop(box);
    return new VmWorld(id, box, backstop);
  }

  /** Run a command as the confined agent user (when the backstop is up), from /workspace. */
  async exec(command: string, timeoutMs = 30_000): Promise<ExecResult> {
    const wrapped = this.backstop === "os-user"
      ? `su - ${AGENT_USER} -c ${shq(`cd ${IN_SCOPE_DIR} && ${command}`)}`
      : `cd ${IN_SCOPE_DIR} && ${command}`;
    const r = await limit(
      this.box.process.executeCommand(wrapped, IN_SCOPE_DIR, { BATMAN_SANDBOX_ID: this.id }, Math.ceil(timeoutMs / 1000)),
      timeoutMs + 15_000, `run: ${command.slice(0, 60)}`,
    );
    return { code: r.exitCode, stdout: r.result, stderr: "" }; // Daytona merges stdout+stderr into result
  }

  /** read_file as the agent user: a normal `cat`, so the OS backstop applies to reads too. */
  async readFile(path: string): Promise<string> {
    const r = await this.exec(`cat ${shq(absolute(path))}`);
    if (r.code !== 0) throw new Error(r.stdout.trim() || `cat ${path}: failed`);
    return r.stdout;
  }

  async runScript(): Promise<ExecResult> { return { code: 0, stdout: "", stderr: "" }; }
  async clone(): Promise<Sandbox> { throw new Error("VmWorld.clone is not used by the cage"); }

  /** Cage containment: cut outbound traffic at the runner (needs Daytona Tier 3+; false if refused). */
  async blockNetwork(): Promise<boolean> {
    try { await limit(this.box.updateNetworkSettings({ networkBlockAll: true }), 30_000, "block network"); return true; }
    catch { return false; }
  }

  async destroy(): Promise<void> { await limit(this.box.delete(), 30_000, "delete VM").catch(() => undefined); }
}

/** Create the confined agent user and make the out-of-scope roots root-only. Returns "none" if the image won't allow it. */
async function trySetupBackstop(box: DaytonaBox): Promise<BackstopMode> {
  const script = [
    `id -u ${AGENT_USER} >/dev/null 2>&1 || useradd -m -s /bin/sh ${AGENT_USER}`,
    `chown -R ${AGENT_USER}:${AGENT_USER} ${IN_SCOPE_DIR}`,
    // Lock the out-of-scope roots: owned by root, no access for others, so the agent user is refused.
    ...LOCKED_ROOTS.map((r) => `[ -e ${r} ] && chown -R root:root ${r} && chmod -R go-rwx ${r} || true`),
    `echo BACKSTOP_OK`,
  ].join(" && ");
  try {
    const r = await limit(box.process.executeCommand(`sh -c ${shq(script)}`, "/", {}, 30), 45_000, "setup backstop");
    return r.exitCode === 0 && r.result.includes("BACKSTOP_OK") ? "os-user" : "none";
  } catch { return "none"; }
}

/** A path from the agent is absolute in the VM; a relative one is resolved under /workspace. */
function absolute(path: string): string {
  return path.startsWith("/") ? path : `${IN_SCOPE_DIR}/${path.replace(/^\.\//, "")}`;
}

/** Single-quote a string for sh. */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
