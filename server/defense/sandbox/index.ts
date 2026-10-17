import { DaytonaSandbox } from "./daytona.js";
import { LocalSandbox } from "./local.js";
import type { Sandbox } from "./types.js";

export type { Sandbox, ExecResult } from "./types.js";
export { LocalSandbox, VIRUS_PATH } from "./local.js";

try { process.loadEnvFile(".env"); } catch { /* no .env: fine */ }

// Explicit opt-in so tests and local dev never spend Daytona sandboxes by accident.
export async function createCompanyMachine(): Promise<Sandbox> {
  return process.env.SANDBOX_BACKEND === "daytona" ? DaytonaSandbox.create() : LocalSandbox.create();
}
