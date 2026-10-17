// Normalises a ToolCall into "what does it touch": a file path, a directory listing, an HTTP
// request, or some other shell command. Shared by the honest env, the simulator and the referee.
import type { ToolCall } from "../../shared/types.js";

export type Target =
  | { kind: "read"; path: string }
  | { kind: "list"; path: string }
  | { kind: "http"; method: "GET" | "POST"; url: URL; body: string; token?: string }
  | { kind: "shell"; command: string; argv: string[] };

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));

/** Whitespace split that respects simple '…' and "…" quoting. Only the first pipeline segment is kept. */
export function splitArgs(command: string): string[] {
  const first = command.split(/\s*(?:\|\||&&|\||;)\s*/)[0] ?? "";
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (let m; (m = re.exec(first)); ) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** Resolves relative paths against the agent's working directory and collapses ".." segments. */
export function normPath(p: string, cwd = "/workspace"): string {
  const abs = p.startsWith("/") ? p : `${cwd}/${p}`;
  const parts: string[] = [];
  for (const seg of abs.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return "/" + parts.join("/");
}

function toUrl(raw: string): URL | null {
  try { return new URL(/^https?:\/\//.test(raw) ? raw : `http://${raw}`); } catch { return null; }
}

function bearer(headers: unknown, body: string): string | undefined {
  const h = headers && typeof headers === "object" ? (headers as Record<string, unknown>) : {};
  const auth = str(h.Authorization ?? h.authorization ?? h["X-Token"] ?? h["x-token"]);
  const m = auth.match(/(?:Bearer\s+)?(\S+)$/i);
  if (auth && m) return m[1];
  const b = body.match(/"?(?:token|api_key|access_token)"?\s*[:=]\s*"?([A-Za-z0-9._\-]+)/i);
  return b?.[1];
}

export function parseCall(call: ToolCall): Target {
  const a = call.args ?? {};
  if (call.tool === "read_file") return { kind: "read", path: normPath(str(a.path ?? a.file)) };
  if (call.tool === "http_get" || call.tool === "http_post") {
    const url = toUrl(str(a.url));
    const body = str(a.body ?? a.data ?? "");
    if (!url) return { kind: "shell", command: `${call.tool} ${str(a.url)}`, argv: [call.tool] };
    return { kind: "http", method: call.tool === "http_post" ? "POST" : "GET", url, body, token: bearer(a.headers, body) };
  }
  const command = str(a.command ?? a.cmd);
  const argv = splitArgs(command);
  const [bin, ...rest] = argv;
  const operands = rest.filter((x) => !x.startsWith("-"));
  if (bin === "cat" || bin === "head" || bin === "tail" || bin === "less" || bin === "strings") {
    if (operands[0]) return { kind: "read", path: normPath(operands[operands.length - 1]) };
  }
  if (bin === "ls" || bin === "find" || bin === "tree") return { kind: "list", path: normPath(operands[0] ?? ".") };
  if (bin === "curl" || bin === "wget") {
    const url = toUrl(rest.find((x) => /^https?:\/\//.test(x) || /\.internal\b/.test(x)) ?? "");
    if (url) {
      const dataIdx = rest.findIndex((x) => x === "-d" || x === "--data" || x === "--data-raw");
      const body = dataIdx >= 0 ? rest[dataIdx + 1] ?? "" : "";
      const hIdx = rest.findIndex((x) => x === "-H" || x === "--header");
      const header = hIdx >= 0 ? rest[hIdx + 1] ?? "" : "";
      const post = dataIdx >= 0 || /-X\s*POST/i.test(command) || rest.includes("POST");
      return { kind: "http", method: post ? "POST" : "GET", url, body, token: bearer({ Authorization: header.replace(/^authorization:\s*/i, "") }, body) };
    }
  }
  return { kind: "shell", command, argv };
}

/** Every path/host the call touches, for scope checks. */
export function touches(t: Target): { paths: string[]; hosts: string[] } {
  if (t.kind === "read" || t.kind === "list") return { paths: [t.path], hosts: [] };
  if (t.kind === "http") return { paths: [], hosts: [t.url.hostname] };
  const paths = t.argv.slice(1).filter((x) => x.startsWith("/") || x.startsWith("..") || x.startsWith("~")).map((x) => normPath(x.replace(/^~/, "/root")));
  return { paths, hosts: [] };
}

export function underAny(path: string, roots: string[]): boolean {
  return roots.some((r) => path === r || path.startsWith(r.endsWith("/") ? r : r + "/"));
}
