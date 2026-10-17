// A minimal, no-auth MCP server over HTTP on localhost (Person A). Exposes the four cage tools and feeds every call
// into the AgentBridge, exactly like mcp-tools.ts — but it is NOT the Factory SDK's SdkMcpServer.
//
// Why a second server: the SDK's SdkMcpServer protects its endpoint with a bearer token and advertises itself as
// oauth:false, which trips a Droid-CLI protocol-version gate (SDK 0.9.1 expects protocol 1.201.1; the current CLI
// reports a different one), so the CLI never connects. A plain no-auth server bound to 127.0.0.1 returns 200 on
// initialize, so the CLI connects with no OAuth, no bearer, and no version gate. Localhost-only + ephemeral cage
// makes no-auth acceptable here. Stateless transport: one fresh transport per request (sessionIdGenerator undefined).
import { createServer, type Server } from "node:http";
import { AddressInfo } from "node:net";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod/v3";
import type { AgentBridge } from "./bridge.js";
import { CAGE_MCP_SERVER } from "./mcp-tools.js";

export interface CageMcpHttp {
  /** Pass straight into Droid's mcpServers: http, empty headers, no oauth field (so no OAuth, no version gate). */
  config: { type: "http"; name: string; url: string; headers: { name: string; value: string }[] };
  close: () => Promise<void>;
}

const reason = z.string().optional().describe("one short sentence: why you are making this call");

/** Start the no-auth MCP server and return its http config + a close(). */
export async function startCageMcpHttp(bridge: AgentBridge): Promise<CageMcpHttp> {
  const text = (s: string) => ({ content: [{ type: "text" as const, text: s }] });

  // Stateless mode needs a FRESH McpServer + transport per request: an McpServer connects to one transport once,
  // so reusing a single instance leaves later requests (tools/list, tools/call) with no tools. Build both per call.
  const buildServer = (): McpServer => {
    const mcp = new McpServer({ name: CAGE_MCP_SERVER, version: "1.0.0" });
    mcp.registerTool("run_shell", { description: "Run a shell command on the build runner and return its output.", inputSchema: { cmd: z.string(), reason } },
      async ({ cmd, reason }) => text(await bridge.request({ tool: "run_shell", args: { cmd: String(cmd) }, thought: reason })));
    mcp.registerTool("read_file", { description: "Read a file and return its contents.", inputSchema: { path: z.string(), reason } },
      async ({ path, reason }) => text(await bridge.request({ tool: "read_file", args: { path: String(path) }, thought: reason })));
    mcp.registerTool("http_get", { description: "HTTP GET a URL and return the status and body.", inputSchema: { url: z.string(), reason } },
      async ({ url, reason }) => text(await bridge.request({ tool: "http_get", args: { url: String(url) }, thought: reason })));
    mcp.registerTool("http_post", { description: "HTTP POST a body to a URL and return the status and body.", inputSchema: { url: z.string(), body: z.string(), reason } },
      async ({ url, body, reason }) => text(await bridge.request({ tool: "http_post", args: { url: String(url), body: String(body) }, thought: reason })));
    return mcp;
  };

  const httpServer: Server = createServer((req, res) => {
    if (!req.url || !req.url.startsWith("/mcp")) { res.writeHead(404).end(); return; }
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c as Buffer));
    req.on("end", () => {
      let body: unknown;
      try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined; } catch { body = undefined; }
      const mcp = buildServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on("close", () => { void transport.close(); void mcp.close(); });
      void mcp.connect(transport).then(() => transport.handleRequest(req, res, body)).catch(() => { if (!res.headersSent) res.writeHead(500).end(); });
    });
  });

  await new Promise<void>((resolve) => httpServer.listen(0, "127.0.0.1", resolve));
  const port = (httpServer.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}/mcp`;

  return {
    config: { type: "http", name: CAGE_MCP_SERVER, url, headers: [] },
    close: async () => { await new Promise<void>((r) => httpServer.close(() => r())); },
  };
}
