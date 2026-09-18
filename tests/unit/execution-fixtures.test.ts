import { describe, expect, test } from "vitest";
import { createRuntimeFixture } from "../utils/execution-fixtures.js";

describe("createRuntimeFixture", () => {
  test("fills in projectionMode and enabled defaults for a partial config", () => {
    expect(createRuntimeFixture({ standard: { projectionMode: "replace" } })).toEqual({
      standard: { enabled: true, projectionMode: "replace" },
    });
  });

  test("skips a runtime explicitly set to undefined", () => {
    expect(createRuntimeFixture({ standard: undefined, "claude-code": { enabled: true } })).toEqual(
      {
        "claude-code": { enabled: true, projectionMode: "merge" },
      },
    );
  });
});
