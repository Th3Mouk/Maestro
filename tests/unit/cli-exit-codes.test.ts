import { describe, expect, test } from "vitest";
import { statusToExitCode } from "../../src/cli/exit-codes.js";

describe("statusToExitCode", () => {
  test.each([
    ["error", 1],
    ["ok", 0],
    ["warning", 0],
  ] as const)("maps %s to exit code %i", (status, exitCode) => {
    expect(statusToExitCode(status)).toBe(exitCode);
  });
});
