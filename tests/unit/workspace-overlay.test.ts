import { lstat, mkdir, readlink, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { syncWorkspaceOverlay } from "../../src/core/execution/workspace-overlay.js";
import { pathExists } from "../../src/utils/fs.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

describe("syncWorkspaceOverlay", () => {
  test.skipIf(process.platform === "win32")(
    "carries projections into the task root and keeps skill links relative",
    async () => {
      const workspaceRoot = await createManagedTempDir("overlay-workspace-");
      const taskRoot = await createManagedTempDir("overlay-task-");
      await mkdir(path.join(workspaceRoot, ".agents", "skills", "runbook"), { recursive: true });
      await writeFile(path.join(workspaceRoot, ".agents", "skills", "runbook", "SKILL.md"), "x\n");
      await mkdir(path.join(workspaceRoot, ".claude", "skills"), { recursive: true });
      await symlink(
        path.join("..", "..", ".agents", "skills", "runbook"),
        path.join(workspaceRoot, ".claude", "skills", "runbook"),
        "dir",
      );
      await mkdir(path.join(workspaceRoot, ".codex", "agents"), { recursive: true });
      await writeFile(path.join(workspaceRoot, ".codex", "agents", "reviewer.toml"), "x\n");
      await mkdir(path.join(workspaceRoot, "workflows"), { recursive: true });
      await writeFile(path.join(workspaceRoot, "workflows", "triage.js"), "x\n");

      await syncWorkspaceOverlay(workspaceRoot, taskRoot);

      const linkedSkill = path.join(taskRoot, ".claude", "skills", "runbook");
      expect((await lstat(linkedSkill)).isSymbolicLink()).toBe(true);
      expect(await readlink(linkedSkill)).toBe(
        path.join("..", "..", ".agents", "skills", "runbook"),
      );
      expect(await pathExists(path.join(linkedSkill, "SKILL.md"))).toBe(true);
      expect(await pathExists(path.join(taskRoot, ".codex", "agents", "reviewer.toml"))).toBe(true);
      expect(await pathExists(path.join(taskRoot, "workflows", "triage.js"))).toBe(true);
    },
  );
});
