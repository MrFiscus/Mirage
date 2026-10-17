import "dotenv/config";
import { createServer } from "node:http";

// Expose only ElevenLabs voice webhooks through a local Cloudflare Quick Tunnel.
// The main server must run separately; its Mirage events and verification state stay together.
const backendPort = Number(process.env.PORT ?? 8787);
const proxyPort = Number(process.env.VOICE_TUNNEL_PORT ?? 3003);
const voicePaths = new Set([
  "/voice/init",
  "/voice/tools/send-code",
  "/voice/tools/verify-code",
  "/voice/tools/mirage-briefing",
  "/voice/post-call"
]);

if (![backendPort, proxyPort].every((port) => Number.isInteger(port) && port > 0 && port <= 65535) || backendPort === proxyPort) {
  throw new Error("PORT and VOICE_TUNNEL_PORT must be distinct valid TCP ports");
}

createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  if (request.method === "GET" && path === "/health") {
    try {
      const backend = await fetch(`http://127.0.0.1:${backendPort}/api/health`, { signal: AbortSignal.timeout(3000) });
      response.writeHead(backend.ok ? 200 : 502, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: backend.ok, service: "batman-voice-tunnel" }));
    } catch {
      response.writeHead(502, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, service: "batman-voice-tunnel" }));
    }
    return;
  }
  if (request.method !== "POST" || !voicePaths.has(path)) {
    response.writeHead(404).end();
    return;
  }

  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.length;
      if (size > 2_000_000) {
        response.writeHead(413).end();
        return;
      }
      chunks.push(bytes);
    }
    const headers: Record<string, string> = {};
    for (const name of ["content-type", "x-batman-secret", "elevenlabs-signature"]) {
      const value = request.headers[name];
      if (typeof value === "string") headers[name] = value;
    }
    const backend = await fetch(`http://127.0.0.1:${backendPort}${path}`, {
      method: "POST", headers, body: Buffer.concat(chunks), signal: AbortSignal.timeout(15_000)
    });
    response.writeHead(backend.status, { "content-type": backend.headers.get("content-type") ?? "application/json" });
    response.end(Buffer.from(await backend.arrayBuffer()));
  } catch {
    if (!response.headersSent) response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Batman backend unavailable" }));
  }
}).listen(proxyPort, "127.0.0.1", () => {
  console.log(`Voice-only tunnel proxy listening on http://127.0.0.1:${proxyPort}`);
});
