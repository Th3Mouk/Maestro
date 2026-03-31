import { afterEach, describe, expect, test, vi } from "vitest";
import { mapWithConcurrency } from "../../src/utils/fs.js";

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

describe("filesystem performance helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("applies bounded concurrency while preserving input order", async () => {
    vi.useFakeTimers();

    const values = [0, 1, 2, 3, 4, 5, 6, 7];
    let inFlight = 0;
    let maxInFlight = 0;

    const resultsPromise = mapWithConcurrency(values, 3, async (value) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await sleep(10);
      inFlight -= 1;
      return value * 2;
    });
    await vi.advanceTimersByTimeAsync(30);
    const results = await resultsPromise;

    expect(maxInFlight).toBeLessThanOrEqual(3);
    expect(results).toEqual(values.map((value) => value * 2));
  });

  test("stops scheduling new work after the first mapper error", async () => {
    vi.useFakeTimers();

    const startedIndices: number[] = [];

    const runPromise = mapWithConcurrency([0, 1, 2, 3, 4], 2, async (value, index) => {
      startedIndices.push(index);
      if (index === 0) {
        throw new Error("boom");
      }

      if (index === 1) {
        await sleep(20);
      }

      return value;
    });
    const advanceTimers = vi.advanceTimersByTimeAsync(20);
    await expect(runPromise).rejects.toThrow("boom");
    await advanceTimers;

    expect(startedIndices).toEqual([0, 1]);
  });

  test("rejects invalid concurrency values", async () => {
    await expect(mapWithConcurrency([1], 0, async (value) => value)).rejects.toThrow(
      "Invalid concurrency",
    );
  });
});
