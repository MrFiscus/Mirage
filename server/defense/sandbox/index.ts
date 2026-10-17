import { DaytonaSandbox } from "./daytona.js";
import { LocalSandbox } from "./local.js";
import type { Sandbox } from "./types.js";

export type { Sandbox, ExecResult } from "./types.js";
export { LocalSandbox, VIRUS_PATH } from "./local.js";

export async function createCompanyMachine(): Promise<Sandbox> {
  return process.env.DAYTONA_API_KEY ? DaytonaSandbox.create() : LocalSandbox.create();
}
