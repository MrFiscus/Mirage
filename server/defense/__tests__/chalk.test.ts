import { describe, expect, it } from "vitest";
import { ChalkInvestigator } from "../chalk.js";
import type { Telemetry } from "../telemetry.js";

const telemetry: Telemetry = {
  processes: ["4242 node -e setInterval(()=>{},1000) rogue-miner-abc"],
  outbound: ["2026-10-17T03:00:00Z OUTBOUND tcp 10.0.0.99:4444 beacon host=acme-payroll-01"],
  cron: [],
  health: [{ name: "app starts", passed: true }, { name: "tests pass", passed: true }, { name: "key files intact", passed: true, detail: "ok" }],
};
const good = { severity: "high", confidence: 0.9, citedEvidence: [0, 1], technicalSummary: "An unexpected process is running and a connection attempt to an unrecognised address was logged.", businessSummary: "A company machine is running an unknown program that tried to reach an outside address. Data loss is unconfirmed." };

function router(content: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

describe("ChalkInvestigator", () => {
  it("calls the Chalk router with the key, env id, model and strict schema", async () => {
    const { calls, fetchImpl } = router(good);
    const inv = await new ChalkInvestigator("ck-test", "openai/m", "https://api.chalk.ai/v1/router/", "env1", fetchImpl).investigate(telemetry);
    expect(calls[0].url).toBe("https://api.chalk.ai/v1/router/chat/completions");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer ck-test");
    expect(headers["x-chalk-env-id"]).toBe("env1");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.model).toBe("openai/m");
    expect(body.response_format.json_schema.strict).toBe(true);
    expect(body.messages[1].content).toContain("<<<DATA");
    expect(inv.engine).toBe("chalk:openai/m");
    expect(inv.severity).toBe("high");
    expect(inv.evidence).toHaveLength(2);
  });

  it("keeps the shared guards: an unsupported claim falls back to rules", async () => {
    const { fetchImpl } = router({ ...good, businessSummary: "A scheduled task was added and files were changed." });
    const inv = await new ChalkInvestigator("k", "m", "https://r", "e", fetchImpl).investigate(telemetry);
    expect(inv.engine).toMatch(/^rules \(/);
  });

  it("falls back to rules when the router errors", async () => {
    const { fetchImpl } = router({}, 502);
    const inv = await new ChalkInvestigator("k", "m", "https://r", "e", fetchImpl).investigate(telemetry);
    expect(inv.engine).toMatch(/HTTP 502/);
  });
});
