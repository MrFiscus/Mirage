import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { fleetSize, runStaggeredFleet } from "../fleet-size.js";
import { mirageRouter } from "../routes.js";
import { runFleet } from "../mock.js";
import { runFleetDaytona } from "../fleet-daytona.js";

// Exercise the actual HTTP boundary without creating sandboxes or invoking providers.
vi.mock("../mock.js", () => ({ runMock: vi.fn(), runFleet: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../fleet-daytona.js", () => ({ runFleetDaytona: vi.fn().mockResolvedValue(undefined) }));

afterEach(() => vi.useRealTimers());

describe("large fleet scheduling", () => {
  it("starts every requested agent without creating one timer per queued agent", async () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    let active = 0;
    let peak = 0;
    const execution = runStaggeredFleet(1000, async (index) => {
      starts.push(index);
      peak = Math.max(peak, ++active);
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
      active--;
    }, 25);

    await vi.advanceTimersByTimeAsync(24);
    expect(starts).toEqual([0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(starts).toEqual([0, 1]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(vi.getTimerCount()).toBeLessThan(25);
    await vi.runAllTimersAsync();
    await execution;
    expect(starts).toEqual(Array.from({ length: 1000 }, (_, index) => index));
    expect(active).toBe(0);
    expect(peak).toBeGreaterThan(1);
  });

  it("awaits the remaining tasks before reporting a failed task", async () => {
    vi.useFakeTimers();
    const completed: number[] = [];
    const execution = runStaggeredFleet(3, async (index) => {
      if (index === 0) throw new Error("creation failed");
      await new Promise<void>((resolve) => setTimeout(resolve, 50));
      completed.push(index);
    }, 10);
    const assertion = expect(execution).rejects.toThrow("creation failed");
    await vi.runAllTimersAsync();
    await assertion;
    expect(completed).toEqual([1, 2]);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])("rejects invalid count %s", (count) => {
    expect(() => fleetSize(count)).toThrow(RangeError);
  });
});

describe("fleet launch API", () => {
  const app = express();
  app.use(express.json(), mirageRouter);
  const server = createServer(app);
  let origin: string;

  beforeAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => {
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  });

  it.each([25, 100, 1000, 10000])("passes all %s requested VMs to the Daytona runner", async (count) => {
    const response = await fetch(`${origin}/mirage/fleet/start?n=${count}&backend=daytona`, { method: "POST" });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ started: true, n: count, backend: "daytona" });
    expect(runFleetDaytona).toHaveBeenCalledWith(count);
    expect(runFleet).not.toHaveBeenCalled();
  });

  it("preserves large counts for the in-process fleet as well", async () => {
    const response = await fetch(`${origin}/mirage/fleet/start`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ n: 1000 }),
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ started: true, n: 1000, backend: "sessions" });
    expect(runFleet).toHaveBeenCalledWith(expect.objectContaining({ n: 1000 }));
  });

  it.each(["0", "-1", "1.5", "NaN", "Infinity", "9007199254740992"])("rejects %s before launching anything", async (count) => {
    const response = await fetch(`${origin}/mirage/fleet/start?n=${count}&backend=daytona`, { method: "POST" });
    expect(response.status).toBe(400);
    expect(runFleetDaytona).not.toHaveBeenCalled();
    expect(runFleet).not.toHaveBeenCalled();
  });
});
