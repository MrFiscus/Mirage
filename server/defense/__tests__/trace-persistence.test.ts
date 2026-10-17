import { randomUUID } from "node:crypto";
import { readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { getTrace, traceStart, traceStep } from "../run.js";

it("keeps the analyst's step-by-step record on disk", () => {
  const id = `inc-trace-${randomUUID()}`;
  const path = resolve(process.cwd(), "data", "defense-traces", `${id}.json`);
  try {
    traceStart(id);
    traceStep(id, "verified", { clean: true });
    const saved = JSON.parse(readFileSync(path, "utf8"));
    expect(saved.steps).toEqual([expect.objectContaining({ kind: "verified", data: { clean: true } })]);
    expect(getTrace(id)?.steps).toHaveLength(1);
  } finally {
    unlinkSync(path);
  }
});
