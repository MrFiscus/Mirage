import { DaytonaSandbox } from "./daytona";
import { LocalSandbox } from "./local";
import type { Sandbox } from "./types";

export type { Sandbox, ExecResult } from "./types";
export { LocalSandbox, VIRUS_PATH } from "./local";

export async function createCompanyMachine(): Promise<Sandbox> {
  return process.env.DAYTONA_API_KEY ? DaytonaSandbox.create() : LocalSandbox.create();
}
