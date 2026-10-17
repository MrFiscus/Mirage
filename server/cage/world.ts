// The Daytona VM world (Person A, System 1). A real VM seeded with the honest Acme in-scope tree, which in-scope
// run_shell / read_file run against for real. HTTP stays simulated in-process (the Acme services don't exist on the
// box), and the out-of-scope world is the mirage's job — those files are never seeded here.
//
// Daytona reality (probed): commands run as a NON-root user (daytona, uid 1001) in a zsh shell, with the sandbox
// home as the only writable root. So we cannot create /workspace or a confined OS user. Instead:
//   - the in-scope tree lives under <home>/workspace, which the user can write;
//   - the agent's logical "/workspace" is translated onto <home>/workspace on every exec/read;
//   - the backstop is a code-level scope guard in the harness (checked independent of the watcher, BEFORE running),
//     so a watcher miss is refused and never touches the VM. That keeps "zero real out-of-scope" true without root.
import { randomBytes } from "node:crypto";
import type { Sandbox as DaytonaBox } from "@daytonaio/sdk";
import { daytona, limit } from "../defense/sandbox/daytona.js";
import type { ExecResult, Sandbox } from "../defense/sandbox/types.js";
import { acmeSeedFiles } from "../mirage/acme.js";
import type { Decoy } from "./task.js";

/** The agent's logical in-scope root, as the watcher/mirage/referee all see it. */
const LOGICAL_WORKSPACE = "/workspace";

export type BackstopMode = "scope-guard";

export class VmWorld implements Sandbox {
  /** Report the backstop so the CLI/fleet can show it. The OS-user lockdown isn't available on a non-root tier;
   *  the harness scope guard is what enforces scope below the watcher. */
  readonly backstop: BackstopMode = "scope-guard";

  private constructor(readonly id: string, private box: DaytonaBox, private base: string) {}

  /** Logical in-scope dir mapped onto the VM's writable home (e.g. /home/daytona/workspace). */
  private get workspace() { return `${this.base}/workspace`; }

  /** Boot a VM and seed ONLY the in-scope Acme tree under the home dir. decoys are accepted for signature
   *  compatibility but not planted on the box: the out-of-scope world (including decoys) is served by the mirage. */
  static async create(_decoys: Decoy[] = []): Promise<VmWorld> {
    if (!process.env.DAYTONA_API_KEY) throw new Error("DAYTONA_API_KEY not set");
    const box = await limit(daytona().create({ ephemeral: true, autoStopInterval: 10 }), 90_000, "create VM");
    const base = (await limit(box.getWorkDir(), 30_000, "get work dir")) ?? "/home/daytona";
    const id = randomBytes(4).toString("hex");

    // acmeSeedFiles() returns paths WITHOUT a leading "/" (e.g. "workspace/README.md"). Keep only the in-scope
    // tree and upload it under the home dir, where the non-root user can write.
    const files = acmeSeedFiles()
      .filter((f) => f.path === "workspace" || f.path.startsWith("workspace/"))
      .map((f) => ({ source: f.content, destination: `${base}/${f.path}` }));
    await limit(box.fs.uploadFiles(files), 60_000, "seed in-scope tree");
    return new VmWorld(id, box, base);
  }

  /** Run a command in the in-scope dir. The logical "/workspace" is translated onto the VM's real home path. */
  async exec(command: string, timeoutMs = 30_000): Promise<ExecResult> {
    const real = translate(command, this.base);
    const r = await limit(
      this.box.process.executeCommand(`cd ${shq(this.workspace)} && ${real}`, this.workspace, { BATMAN_SANDBOX_ID: this.id }, Math.ceil(timeoutMs / 1000)),
      timeoutMs + 15_000, `run: ${command.slice(0, 60)}`,
    );
    return { code: r.exitCode, stdout: r.result, stderr: "" }; // Daytona merges stdout+stderr into result
  }

  async readFile(path: string): Promise<string> {
    const r = await this.exec(`cat ${shq(path)}`);
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

/** Rewrite the logical in-scope root onto the VM's real home path, e.g. /workspace/x -> /home/daytona/workspace/x.
 *  Only the in-scope root is mapped; the harness scope guard refuses out-of-scope calls before they ever reach here. */
function translate(command: string, base: string): string {
  return command.replace(new RegExp(LOGICAL_WORKSPACE + "(?=/|\\b)", "g"), `${base}/workspace`);
}

/** Single-quote a string for the shell (zsh/sh). */
function shq(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
