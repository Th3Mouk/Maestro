import path from "node:path";
import { describe, expect, test } from "vitest";
import { resolveWorkspacePath } from "../../src/cli/program/shared-options.js";

describe("resolveWorkspacePath", () => {
  test("makes a relative path absolute, rooted at the current working directory", () => {
    const resolved = resolveWorkspacePath("some/workspace");

    expect(path.isAbsolute(resolved)).toBe(true);
    expect(resolved.startsWith(process.cwd())).toBe(true);
    expect(resolved.endsWith(path.join("some", "workspace"))).toBe(true);
  });

  test("leaves an already-absolute path unchanged", () => {
    const absolute = "/tmp/existing-workspace";
    expect(resolveWorkspacePath(absolute)).toBe(absolute);
  });
});
