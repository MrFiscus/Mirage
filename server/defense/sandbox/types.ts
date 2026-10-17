export interface ExecResult { code: number; stdout: string; stderr: string; }

// The company machine and its clone are both Sandboxes. LocalSandbox is the mock;
// DaytonaSandbox is the real thing once DAYTONA_API_KEY exists.
export interface Sandbox {
  readonly id: string;
  exec(command: string, timeoutMs?: number): Promise<ExecResult>;
  readFile(path: string): Promise<string>;
  clone(): Promise<Sandbox>;
  destroy(): Promise<void>;
}
