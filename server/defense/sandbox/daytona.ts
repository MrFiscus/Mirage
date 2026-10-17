import type { ExecResult, Sandbox } from "./types";

// Stub. Fill in with @daytonaio/sdk once DAYTONA_API_KEY exists, and measure clone speed first.
export class DaytonaSandbox implements Sandbox {
  readonly id = "daytona";
  static async create(): Promise<DaytonaSandbox> {
    if (!process.env.DAYTONA_API_KEY) throw new Error("DAYTONA_API_KEY not set: use LocalSandbox");
    throw new Error("DaytonaSandbox not implemented yet");
  }
  exec(_c: string): Promise<ExecResult> { throw new Error("not implemented"); }
  readFile(_p: string): Promise<string> { throw new Error("not implemented"); }
  clone(): Promise<Sandbox> { throw new Error("not implemented"); }
  destroy(): Promise<void> { throw new Error("not implemented"); }
}
