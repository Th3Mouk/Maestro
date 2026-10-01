import { describe, expect, test } from "vitest";
import {
  describeUnprunableWork,
  evaluateTaskPrunability,
} from "../../src/core/execution/checkout-state.js";
import type { TaskCheckoutState } from "../../src/report/types.js";

function checkout(overrides: Partial<TaskCheckoutState> = {}): TaskCheckoutState {
  return {
    name: "foods",
    path: "/tmp/task/repos/foods",
    branch: "platform/t/foods",
    dirty: false,
    localOnly: 0,
    upstream: "tracking",
    integrated: false,
    ...overrides,
  };
}

describe("describeUnprunableWork", () => {
  const strict = { includeGone: false };

  test("a clean checkout without local-only commits is prunable", () => {
    expect(describeUnprunableWork(checkout(), "foods", strict)).toBeUndefined();
  });

  test("integrated local-only commits are prunable", () => {
    expect(
      describeUnprunableWork(checkout({ localOnly: 3, integrated: true }), "foods", strict),
    ).toBeUndefined();
  });

  test("dirty wins over everything else", () => {
    expect(describeUnprunableWork(checkout({ dirty: true }), "foods", strict)).toBe("dirty: foods");
  });

  test("an inspection error keeps the checkout", () => {
    expect(describeUnprunableWork(checkout({ error: "boom" }), "foods", strict)).toBe(
      "cannot inspect foods: boom",
    );
  });

  test("unintegrated local-only commits keep the checkout", () => {
    expect(describeUnprunableWork(checkout({ localOnly: 1 }), "foods", strict)).toBe(
      "1 local-only commit in foods",
    );
  });

  test("a gone upstream only counts with includeGone", () => {
    const gone = checkout({ localOnly: 2, upstream: "gone" });
    expect(describeUnprunableWork(gone, "foods", strict)).toBe(
      "2 local-only commits in foods (upstream gone; --include-gone prunes it)",
    );
    expect(describeUnprunableWork(gone, "foods", { includeGone: true })).toBeUndefined();
    expect(describeUnprunableWork({ ...gone, dirty: true }, "foods", { includeGone: true })).toBe(
      "dirty: foods",
    );
  });
});

describe("evaluateTaskPrunability", () => {
  test("collects one reason per unsafe checkout", () => {
    expect(
      evaluateTaskPrunability(
        [
          checkout({ name: "ws" }),
          checkout({ dirty: true }),
          checkout({ name: "api", localOnly: 2 }),
        ],
        { includeGone: false },
      ),
    ).toEqual({
      prunable: false,
      reasons: ["dirty: foods", "2 local-only commits in api"],
    });
  });

  test("a task whose checkouts are all safe is prunable", () => {
    expect(evaluateTaskPrunability([checkout()], { includeGone: false })).toEqual({
      prunable: true,
      reasons: [],
    });
  });
});
