import { describe, expect, test } from "vitest";
import { createRuntimeFixture } from "../utils/execution-fixtures.js";

describe("createRuntimeFixture", () => {
  test("resolves asset projections from a partial runtime config", () => {
    expect(createRuntimeFixture({ standard: { projectionMode: "replace" } })).toEqual({
      standard: { skills: { mode: "replace", strategy: "copy" } },
    });
  });

  test("skips a runtime explicitly set to undefined", () => {
    expect(createRuntimeFixture({ standard: undefined, "claude-code": { enabled: true } })).toEqual(
      {
        "claude-code": {
          skills: { mode: "merge", strategy: "symlink" },
          workflows: { mode: "merge" },
        },
      },
    );
  });
});
