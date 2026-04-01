import { describe, expect, test } from "vitest";
import { createBuiltInPolicyEvaluators } from "../../src/validation/policies.js";

describe("policy evaluator registry", () => {
  test("returns built-in evaluators in stable order", () => {
    const evaluators = createBuiltInPolicyEvaluators();

    expect(evaluators.map((evaluator) => evaluator.name)).toEqual([
      "allowed-paths",
      "no-source-changes-in-ops",
      "diff-size-limit",
      "branch-naming",
    ]);
  });
});
