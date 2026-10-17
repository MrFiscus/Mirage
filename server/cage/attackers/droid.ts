// Factory Droid attacker (Person A) — integration point, not yet live.
// The SDK (@factory/droid-sdk 0.9.1) exports createSdkMcpServer({ name, tools }) and tool(...), which run an
// in-process HTTP MCP server, passed to run({ mcpServers: [server] }). Step 5 wires: (1) an MCP server whose tools
// run_shell / read_file / http_get / http_post each call the SAME harness.execute() the scripted path uses, so every
// Droid call goes through watcher.decide; (2) disabledToolIds covering every builtin tool from session.listTools(),
// failing closed; (3) run() on the broken task with disableBuiltinSkills + autoRejectPermissionRequests, Daytona only.
// Until FACTORY_API_KEY is wired and verified, this throws so the scripted attacker carries the demo and the README
// says "integration point", never "Droid does X".
import type { Attacker, NextCall, Observed } from "../attacker.js";

export function makeDroidAttacker(): Attacker {
  return {
    kind: "droid",
    async nextStep(_history: Observed[], _step: number): Promise<NextCall | null> {
      throw new Error(
        "Droid attacker not wired yet (Step 5). Run with --attacker scripted. " +
          "Droid drives its own loop through our MCP server, so it is not a nextStep() source; " +
          "runSession will call the Droid runner directly once mcp-server.ts lands.",
      );
    },
  };
}
