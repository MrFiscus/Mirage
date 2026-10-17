import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { Daytona, type Sandbox as DaytonaBox } from "@daytonaio/sdk";
import { buildSeed } from "./seed.js";
import { AGENT_PATH, LIVE_QUERY, respawnArgs, VIRUS_PATH } from "./local.js";
import type { ExecResult, Sandbox } from "./types.js";

/** Daytona calls that never answer must fail loudly, not leave the demo waiting forever. */
function limit<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Daytona did not respond to "${what}" within ${Math.round(ms / 1000)} s`)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

let client: Daytona | undefined;
const daytona = () => (client ??= new Daytona({ apiKey: process.env.DAYTONA_API_KEY }));

/**
 * Real company machine / clone on Daytona. Native fork is not available on our account,
 * so clone() creates a second sandbox and replays the first one's files (and the simulated processes still running).
 */
export class DaytonaSandbox implements Sandbox {
  private constructor(readonly id: string, private box: DaytonaBox, private root: string) {}
  private get appDir() { return `${this.root}/app`; }

  static async create(): Promise<DaytonaSandbox> {
    if (!process.env.DAYTONA_API_KEY) throw new Error("DAYTONA_API_KEY not set");
    // ephemeral: deleted when stopped, so a crashed demo does not leak sandboxes
    const box = await limit(daytona().create({ ephemeral: true, autoStopInterval: 10 }), 90_000, "create machine");
    const root = (await limit(box.getWorkDir(), 30_000, "get work dir")) ?? "/home/daytona";
    const sb = new DaytonaSandbox(randomBytes(4).toString("hex"), box, root);
    await limit(box.fs.uploadFiles((await buildSeed()).map((f) => ({ source: f.content, destination: `${sb.appDir}/${f.path}` }))), 60_000, "upload app files");
    return sb;
  }

  async exec(command: string, timeoutMs = 30_000): Promise<ExecResult> {
    const r = await limit(this.box.process.executeCommand(command, this.appDir, { BATMAN_SANDBOX_ID: this.id }, Math.ceil(timeoutMs / 1000)), timeoutMs + 15_000, `run: ${command.slice(0, 60)}`);
    return { code: r.exitCode, stdout: r.result, stderr: "" }; // Daytona returns stdout and stderr merged
  }

  async runScript(localPath: string, args = ""): Promise<ExecResult> {
    const dest = `${this.root}/.tools/${basename(localPath)}`;
    await limit(this.box.fs.uploadFile(await readFile(localPath), dest), 60_000, `upload ${basename(localPath)}`);
    return this.exec(`node "${dest}" ${args}`);
  }

  async readFile(path: string): Promise<string> {
    if (path.split("/").includes("..")) throw new Error("path escapes sandbox");
    return (await limit(this.box.fs.downloadFile(`${this.appDir}/${path}`), 30_000, `read ${path}`)).toString("utf8");
  }

  async clone(): Promise<DaytonaSandbox> {
    const copy = await DaytonaSandbox.createEmpty();
    const list = await this.exec("find . -type f -not -path './.run/*'");
    const paths = list.stdout.split("\n").map((p) => p.trim().replace(/^\.\//, "")).filter(Boolean);
    const files = await Promise.all(paths.map(async (p) => ({ source: await limit(this.box.fs.downloadFile(`${this.appDir}/${p}`), 30_000, `copy ${p}`), destination: `${copy.appDir}/${p}` })));
    await limit(copy.box.fs.uploadFiles(files), 60_000, "upload files to the copy");
    if ((await this.exec("test -f .run/rogue.pid")).code === 0) await copy.runScript(VIRUS_PATH, "respawn");
    const agentProcs = respawnArgs((await this.exec(LIVE_QUERY)).stdout);
    if (agentProcs.length) await copy.runScript(AGENT_PATH, `respawn ${agentProcs.join(" ")}`);
    return copy;
  }

  private static async createEmpty(): Promise<DaytonaSandbox> {
    const box = await limit(daytona().create({ ephemeral: true, autoStopInterval: 10 }), 90_000, "create test copy");
    return new DaytonaSandbox(randomBytes(4).toString("hex"), box, (await limit(box.getWorkDir(), 30_000, "get work dir")) ?? "/home/daytona");
  }

  async destroy(): Promise<void> {
    await limit(this.box.delete(), 30_000, "delete machine");
  }
}
