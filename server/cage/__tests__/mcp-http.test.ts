import { describe, expect, it } from "vitest";
// The no-auth localhost MCP server used for the live Droid run: it must expose exactly the four cage tools over a
// plain (no bearer, no OAuth) streamable-HTTP endpoint and feed each call into the bridge. This is what lets the
// Droid CLI connect despite the SDK/CLI oauth-opt-out protocol skew.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { AgentBridge } from "../bridge.js";
import { startCageMcpHttp } from "../mcp-http.js";
import { CAGE_TOOL_NAMES } from "../mcp-tools.js";

describe("no-auth cage MCP server (live Droid transport)", () => {
  it("exposes the four cage tools over plain HTTP and routes a call into the bridge", { timeout: 20_000 }, async () => {
    const bridge = new AgentBridge();
    const mcp = await startCageMcpHttp(bridge);
    expect(mcp.config.type).toBe("http");
    expect(mcp.config.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    const client = new Client({ name: "test", version: "0" });
    try {
      // No headers at all — proves the endpoint needs no auth (that is the whole point).
      await client.connect(new StreamableHTTPClientTransport(new URL(mcp.config.url)));
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual([...CAGE_TOOL_NAMES].sort());

      const pending = client.callTool({ name: "read_file", arguments: { path: "/workspace/README.md", reason: "look" } });
      const call = await bridge.take([]);
      expect(call).toEqual({ tool: "read_file", args: { path: "/workspace/README.md" }, thought: "look" });
      void bridge.take([{ call: call as never, decision: "pass", output: "# task", exitCode: 0 }]);
      const res = (await pending) as { content: { type: string; text: string }[] };
      expect(res.content[0].text).toBe("# task");
    } finally {
      bridge.finish();
      await client.close().catch(() => undefined);
      await mcp.close();
    }
  });
});
