import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const SIM_DIR = fileURLToPath(new URL("../../../sim", import.meta.url));
export const KEY_FILES = ["lib.cjs", "config.json", "server.cjs"];

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

/** Paths always use "/" because they become Linux paths inside the sandbox, even when the server runs on Windows. */
/** Every file of a fresh company machine: the sim app plus a trusted baseline of the key files. */
export async function buildSeed(): Promise<{ path: string; content: Buffer }[]> {
  const appDir = join(SIM_DIR, "app");
  const files = await Promise.all((await walk(appDir)).map(async (p) => ({ path: relative(appDir, p).split(sep).join("/"), content: await readFile(p) })));
  const hashes: Record<string, string> = {};
  for (const f of KEY_FILES) {
    const c = files.find((x) => x.path === f)!.content;
    hashes[f] = createHash("sha256").update(c).digest("hex");
    files.push({ path: posix.join(".baseline", f), content: c });
  }
  files.push({ path: posix.join(".baseline", "hashes.json"), content: Buffer.from(JSON.stringify(hashes)) });
  return files;
}
