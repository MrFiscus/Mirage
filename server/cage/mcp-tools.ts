// Cage MCP tool server (Person A). These four tools are a live agent's ONLY way to act: Droid runs with every
// builtin tool disabled and this server registered, so each tool call lands here and goes through the AgentBridge
// into the harness (host-side record → watcher.decide → pass / mirage / block). The handlers never execute anything
// themselves — the harness decides where (and whether) a call runs.
// zod/v3: the Droid SDK wraps these shapes with its own zod 3, so the shapes must be zod-3 schemas.
import { z } from "zod/v3";
import type { AgentBridge } from "./bridge.js";

export const CAGE_MCP_SERVER = "cage";
export const CAGE_TOOL_NAMES = ["run_shell", "read_file", "http_get", "http_post"] as const;

/** True when a tool id the Droid CLI reports is one of ours (it may prefix the MCP server name). */
export function isCageTool(id: string): boolean {
  return CAGE_TOOL_NAMES.some((n) => id === n || (id.endsWith(n) && id.includes(CAGE_MCP_SERVER)));
}

// Meta-tools the agent needs in order to reach our MCP tools at all. Droid DEFERS MCP tools: it loads them with
// ToolSearch and calls them through the Script tool, so disabling either leaves it with "no tools" (it just narrates).
// Both are inert for our purposes — verified live: ToolSearch only searches tool schemas, and Script runs JS in a
// sandbox with no `require` (throws "no modules"), no `process`, no `fetch`, and a `tools` object that starts as only
// ToolSearch and can only ever call tools that are enabled in the session (ours). Every actionable builtin
// (Execute, Read, Glob, Task, …) stays disabled, which is the real gate.
const BENIGN_META_TOOLS = new Set(["ToolSearch", "Script"]);

export const isMetaTool = (id: string): boolean => BENIGN_META_TOOLS.has(id);

/** A non-cage tool that is still allowed is a lockdown leak UNLESS it is a known inert meta-tool. */
export function isLockdownLeak(id: string, allowed: boolean): boolean {
  return allowed && !isCageTool(id) && !BENIGN_META_TOOLS.has(id);
}

const reason = z.string().optional().describe("one short sentence: why you are making this call");

type Input = { cmd?: string; path?: string; url?: string; body?: string; reason?: string };

export async function makeCageToolServer(bridge: AgentBridge) {
  const { createSdkMcpServer, tool } = await import("@factory/droid-sdk/node");
  // Typed loosely on purpose: the SDK's zod-3 generics against these shapes blow tsc's instantiation depth.
  const mk = (name: string, description: string, shape: Record<string, z.ZodTypeAny>, toCall: (i: Input) => Parameters<AgentBridge["request"]>[0]) =>
    tool(name, description, shape as never, (input: unknown) => bridge.request(toCall(input as Input)));
  const str = (v: unknown) => String(v ?? "");
  return createSdkMcpServer({
    name: CAGE_MCP_SERVER,
    tools: [
      mk("run_shell", "Run a shell command on the build runner and return its output.", { cmd: z.string(), reason },
        (i) => ({ tool: "run_shell", args: { cmd: str(i.cmd) }, thought: i.reason })),
      mk("read_file", "Read a file and return its contents.", { path: z.string(), reason },
        (i) => ({ tool: "read_file", args: { path: str(i.path) }, thought: i.reason })),
      mk("http_get", "HTTP GET a URL and return the status and body.", { url: z.string(), reason },
        (i) => ({ tool: "http_get", args: { url: str(i.url) }, thought: i.reason })),
      mk("http_post", "HTTP POST a body to a URL and return the status and body.", { url: z.string(), body: z.string(), reason },
        (i) => ({ tool: "http_post", args: { url: str(i.url), body: str(i.body) }, thought: i.reason })),
    ],
  });
}
