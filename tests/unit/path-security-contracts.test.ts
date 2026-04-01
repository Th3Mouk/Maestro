import path from "node:path";
import { describe, expect, test } from "vitest";
import { resolveSafePath } from "../../src/utils/fs.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

describe("path security contracts", () => {
  test("rejects nested traversal segments that escape the root", async () => {
    const root = await createManagedTempDir("maestro-path-contract-traversal-");

    expect(() =>
      resolveSafePath(root, "repos/safe/../../../../outside", "repository root"),
    ).toThrow("repository root escapes the allowed root");
  });

  test("rejects absolute target paths that bypass the root", async () => {
    const root = await createManagedTempDir("maestro-path-contract-absolute-");
    const outsideAbsolutePath = path.resolve(root, "..", "..", "outside");

    expect(() => resolveSafePath(root, outsideAbsolutePath, "repository root")).toThrow(
      "repository root escapes the allowed root",
    );
  });

  test("rejects traversal segments mixed with current-directory markers", async () => {
    const root = await createManagedTempDir("maestro-path-contract-dot-segments-");
    const traversalWithDotMarkers = "./repos/./safe/../../../../outside";

    expect(() => resolveSafePath(root, traversalWithDotMarkers, "repository root")).toThrow(
      "repository root escapes the allowed root",
    );
  });
});
