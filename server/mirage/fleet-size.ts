/** Fleet size has no product cap. Reject counts that cannot be represented exactly. */
export function fleetSize(value: unknown = 6): number {
  const count = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError("Agent count must be a positive whole number within the safe integer range.");
  }
  return count;
}

/** Schedule starts incrementally so large fleets do not allocate N timers up front. */
export async function runStaggeredFleet(count: number, run: (index: number) => Promise<unknown>, staggerMs: number): Promise<void> {
  const size = fleetSize(count);
  const active = new Set<Promise<void>>();
  let failure: unknown;
  let failed = false;
  for (let index = 0; index < size; index++) {
    const task = Promise.resolve().then(() => run(index))
      .then(() => undefined)
      .catch((error: unknown) => { if (!failed) failure = error; failed = true; })
      .finally(() => active.delete(task));
    active.add(task);
    if (index + 1 < size) await new Promise<void>((resolve) => setTimeout(resolve, staggerMs));
  }
  await Promise.all(active);
  if (failed) throw failure;
}
