import { DaytonaSandbox } from "./daytona.js";
import { LocalSandbox } from "./local.js";
import type { Sandbox } from "./types.js";

export type { Sandbox, ExecResult } from "./types.js";
export { LocalSandbox, VIRUS_PATH } from "./local.js";

try { process.loadEnvFile(".env"); } catch { /* no .env: fine */ }

// Explicit opt-in so tests and local dev never spend Daytona sandboxes by accident.
export async function createCompanyMachine(): Promise<Sandbox> {
  if (process.env.SANDBOX_BACKEND === "daytona") return DaytonaSandbox.create();
  if (process.platform === "win32") {
    throw new Error("The local sandbox needs Linux tools and cannot run on Windows. Put SANDBOX_BACKEND=daytona and DAYTONA_API_KEY in .env (in the folder you run npm run dev from) and restart.");
  }
  return LocalSandbox.create();
}
