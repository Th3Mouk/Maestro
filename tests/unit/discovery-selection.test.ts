import { describe, expect, test } from "vitest";
import { resolveNameSelection } from "../../src/workspace/discovery/selection.js";

describe("resolveNameSelection", () => {
  test("selects every available name when the selection is omitted", () => {
    expect(resolveNameSelection(undefined, ["alpha", "beta"])).toEqual(new Set(["alpha", "beta"]));
  });

  test("selects exactly the listed names when given a plain array", () => {
    expect(resolveNameSelection(["alpha", "gamma"], ["alpha", "beta"])).toEqual(
      new Set(["alpha", "gamma"]),
    );
  });

  test("selects every available name except the excluded ones", () => {
    expect(resolveNameSelection({ exclude: ["beta"] }, ["alpha", "beta", "gamma"])).toEqual(
      new Set(["alpha", "gamma"]),
    );
  });
});
