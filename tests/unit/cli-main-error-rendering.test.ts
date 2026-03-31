import { describe, expect, test } from "vitest";
import { formatUnhandledCliError, isVerboseErrorMode } from "../../src/cli/main.js";

describe("CLI unhandled error rendering", () => {
  test("does not print raw stack traces by default", () => {
    const error = new Error("Boom");
    error.stack = "Error: Boom\n    at hidden:1:1";

    const output = formatUnhandledCliError(error, { showStack: false });

    expect(output).toBe("Boom\n");
    expect(output).not.toContain("at hidden:1:1");
  });

  test("prints stack traces when verbose mode is explicitly enabled", () => {
    const error = new Error("Boom");
    error.stack = "Error: Boom\n    at visible:1:1";

    expect(isVerboseErrorMode({ MAESTRO_VERBOSE: "1" })).toBe(true);
    const output = formatUnhandledCliError(error, {
      showStack: isVerboseErrorMode({ MAESTRO_VERBOSE: "1" }),
    });

    expect(output).toContain("Error: Boom");
    expect(output).toContain("at visible:1:1");
  });
});
