import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createBuiltInProjectors } from "../../src/adapters/runtimes/index.js";
import { pathExists } from "../../src/utils/fs.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";
import { createResolvedWorkspaceFixture } from "../utils/execution-fixtures.js";

describe("built-in runtime projectors", () => {
  test("fall back to merge projection mode when the runtime has no config entry", async () => {
    const workspaceRoot = await createManagedTempDir("runtime-projectors-default-mode-");
    for (const skillsDir of [
      path.join(workspaceRoot, ".claude", "skills", "hand-written"),
      path.join(workspaceRoot, ".agents", "skills", "hand-written"),
    ]) {
      await mkdir(skillsDir, { recursive: true });
      await writeFile(path.join(skillsDir, "SKILL.md"), "hand-written, not managed by Maestro\n");
    }

    // No "claude-code"/"standard" entry at all in runtimes — projectors are called
    // directly here, bypassing the enabled-runtime filter that normally guarantees
    // an entry (and thus a resolved projectionMode) is present.
    const resolvedWorkspace = createResolvedWorkspaceFixture({ runtimes: {} });
    const projectors = createBuiltInProjectors();
    const claudeCodeProjector = projectors.find((projector) => projector.name === "claude-code")!;
    const standardProjector = projectors.find((projector) => projector.name === "standard")!;

    await claudeCodeProjector.project({ workspaceRoot, resolvedWorkspace });
    await standardProjector.project({ workspaceRoot, resolvedWorkspace });

    expect(
      await pathExists(path.join(workspaceRoot, ".claude", "skills", "hand-written", "SKILL.md")),
    ).toBe(true);
    expect(
      await pathExists(path.join(workspaceRoot, ".agents", "skills", "hand-written", "SKILL.md")),
    ).toBe(true);
  });
});
