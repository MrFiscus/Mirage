export interface ExecResult { code: number; stdout: string; stderr: string; }

// The company machine and its clone are both Sandboxes. LocalSandbox is the mock;
// DaytonaSandbox is the real thing (SANDBOX_BACKEND=daytona).
export interface Sandbox {
  readonly id: string;
  exec(command: string, timeoutMs?: number): Promise<ExecResult>;
  /** Copies a script from this host into the sandbox and runs it with node (used for the simulated virus). */
  runScript(localPath: string, args?: string): Promise<ExecResult>;
  readFile(path: string): Promise<string>;
  clone(): Promise<Sandbox>;
  destroy(): Promise<void>;
}
