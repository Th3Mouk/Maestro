import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { GitAdapter } from "../../src/adapters/git/git-adapter.js";
import { createCommandContext, type GitCommandAdapter } from "../../src/core/command-context.js";
import { createTaskWorktree, pruneTaskWorktrees } from "../../src/core/commands/execution.js";
import { branchExists, createLifecycleWorkspace, git } from "../utils/worktree-workspace.js";

/** A real Git adapter that records the calls made to the given methods. */
function createRecordingGitAdapter(methods: Array<keyof GitCommandAdapter>): {
  adapter: GitCommandAdapter;
  calls: Array<{ method: string; repoRoot: string }>;
} {
  const real = new GitAdapter();
  const calls: Array<{ method: string; repoRoot: string }> = [];
  const adapter = new Proxy(real, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function") {
        return value;
      }
      const method = (value as (...args: unknown[]) => unknown).bind(target);
      if (!methods.includes(property as keyof GitCommandAdapter)) {
        return method;
      }
      return (repoRoot: string, ...rest: unknown[]) => {
        calls.push({ method: String(property), repoRoot });
        return method(repoRoot, ...rest);
      };
    },
  });
  return { adapter, calls };
}

describe("prune --task", () => {
  test("removes only the named task, and fetches only its repositories", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const a = await createTaskWorktree(workspaceRoot, "a", { repos: ["foods"] });
    const b = await createTaskWorktree(workspaceRoot, "b", { repos: ["platform-api"] });
    const { adapter, calls } = createRecordingGitAdapter(["fetch"]);

    const report = await pruneTaskWorktrees(
      workspaceRoot,
      { tasks: ["a"] },
      createCommandContext({ gitAdapter: adapter }),
    );

    expect(report.status).toBe("ok");
    expect(report.removed).toEqual(["a"]);
    expect(existsSync(a.root)).toBe(false);
    expect(existsSync(b.root)).toBe(true);
    expect(calls.map((call) => call.repoRoot).sort()).toEqual(
      [workspaceRoot, path.join(workspaceRoot, "repos", "foods")].sort(),
    );
  });

  test("an unknown task fails with WORKTREE_NOT_FOUND and removes nothing", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const kept = await createTaskWorktree(workspaceRoot, "kept", { repos: ["foods"] });

    const report = await pruneTaskWorktrees(workspaceRoot, { tasks: ["kept", "ghost"] });

    expect(report.status).toBe("error");
    expect(report.issues).toEqual([expect.objectContaining({ code: "WORKTREE_NOT_FOUND" })]);
    expect(report.removed).toEqual([]);
    expect(existsSync(kept.root)).toBe(true);
  });

  test("with --branches, only the orphan branches of the named tasks are considered", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const foodsClone = path.join(workspaceRoot, "repos", "foods");
    await git(foodsClone, ["branch", "platform/old/foods", "main"]);
    await git(foodsClone, ["branch", "platform/other/foods", "main"]);

    const report = await pruneTaskWorktrees(workspaceRoot, { branches: true, tasks: ["old"] });

    expect(report.status).toBe("ok");
    expect(report.deletedBranches).toEqual([{ name: "foods", branch: "platform/old/foods" }]);
    expect(await branchExists(foodsClone, "platform/old/foods")).toBe(false);
    expect(await branchExists(foodsClone, "platform/other/foods")).toBe(true);
  });
});
