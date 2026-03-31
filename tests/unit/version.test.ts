import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { initWorkspace } from "../../src/core/commands.js";
import { getFrameworkRange, getFrameworkVersion } from "../../src/version.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

describe("framework version contract", () => {
  test("reads the framework version from package metadata", async () => {
    const packageJson = JSON.parse(
      await readFile(path.join(process.cwd(), "package.json"), "utf8"),
    ) as { version: string };

    expect(getFrameworkVersion()).toBe(packageJson.version);
    expect(getFrameworkRange()).toBe(`^${packageJson.version}`);
  });

  test("uses the framework version when scaffolding a workspace", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-init-");
    await initWorkspace(workspaceRoot);

    const workspaceManifest = await readFile(path.join(workspaceRoot, "maestro.yaml"), "utf8");
    const workspacePackage = await readFile(path.join(workspaceRoot, "package.json"), "utf8");

    expect(workspaceManifest).toContain(`version: ${getFrameworkRange()}`);
    expect(workspacePackage).toContain(`"maestro": "${getFrameworkRange()}"`);
  });
});
