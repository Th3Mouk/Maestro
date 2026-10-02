import { existsSync } from "node:fs";
import { mkdir, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { GitAdapter } from "../../src/adapters/git/git-adapter.js";
import { createCommandContext, type GitCommandAdapter } from "../../src/core/command-context.js";
import { doctorWorkspace } from "../../src/core/commands.js";
import {
  createTaskWorktree,
  listTaskWorktrees,
  pruneTaskWorktrees,
  removeTaskWorktree,
} from "../../src/core/commands/execution.js";
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

describe("foreign directories under rootDir", () => {
  test("a hand-made git worktree is listed as foreign and never touched", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const foodsClone = path.join(workspaceRoot, "repos", "foods");
    const handMade = path.join(workspaceRoot, "worktrees", "calc-errors-no-sentry");
    await mkdir(path.dirname(handMade), { recursive: true });
    await git(foodsClone, ["worktree", "add", "-b", "calc-errors", handMade, "main"]);
    const scratch = path.join(workspaceRoot, "worktrees", "notes");
    await mkdir(scratch, { recursive: true });
    await writeFile(path.join(scratch, "todo.md"), "- x\n", "utf8");
    await createTaskWorktree(workspaceRoot, "real", { repos: ["foods"] });

    const listed = await listTaskWorktrees(workspaceRoot);
    expect(listed.status).toBe("ok");
    expect(listed.worktrees.map((worktree) => worktree.name)).toEqual(["real"]);
    expect(listed.foreign).toEqual([
      { path: handMade, kind: "git-worktree", source: await realpath(foodsClone) },
      { path: scratch, kind: "directory" },
    ]);

    const report = await pruneTaskWorktrees(workspaceRoot);

    expect(report.status).toBe("ok");
    expect(report.removed).toEqual(["real"]);
    expect(report.issues.map((issue) => [issue.code, issue.path])).toEqual([
      ["WORKTREE_FOREIGN", handMade],
      ["WORKTREE_FOREIGN", scratch],
    ]);
    expect(existsSync(path.join(handMade, "README.md"))).toBe(true);
    expect(existsSync(path.join(scratch, "todo.md"))).toBe(true);
    expect(await branchExists(foodsClone, "calc-errors")).toBe(true);

    const removal = await removeTaskWorktree(workspaceRoot, "calc-errors-no-sentry", {
      force: true,
    });
    expect(removal.issues.map((issue) => issue.code)).toEqual(["WORKTREE_FOREIGN"]);
    expect(existsSync(path.join(handMade, "README.md"))).toBe(true);
  });
});

describe("workspace doctor and task worktrees", () => {
  test("flags workspace worktrees outside rootDir and nested in a task", async () => {
    const { root, workspaceRoot } = await createLifecycleWorkspace();
    const outside = path.join(root, "claude-desktop", "agent-1");
    await git(workspaceRoot, ["worktree", "add", "-b", "agent-1", outside, "main"]);
    const task = await createTaskWorktree(workspaceRoot, "outer", { repos: ["foods"] });
    const nested = path.join(task.root, "worktrees", "inner");
    await git(workspaceRoot, ["worktree", "add", "-b", "inner", nested, "main"]);

    const report = await doctorWorkspace(workspaceRoot);
    const worktreeIssues = report.issues
      .filter((issue) => issue.code.startsWith("TASK_"))
      .map((issue) => [issue.code, issue.path]);

    expect(worktreeIssues).toEqual(
      expect.arrayContaining([
        ["TASK_OUTSIDE_ROOT", await realpath(outside)],
        ["TASK_NESTED", await realpath(nested)],
      ]),
    );
    expect(worktreeIssues).toHaveLength(2);
  });

  test("reports a repository worktree whose directory is gone, and --fix prunes it", async () => {
    const { root, workspaceRoot } = await createLifecycleWorkspace();
    const foodsClone = path.join(workspaceRoot, "repos", "foods");
    const deleted = path.join(root, "deleted-worktree");
    await git(foodsClone, ["worktree", "add", "-b", "gone-dir", deleted, "main"]);
    await rm(deleted, { recursive: true, force: true });

    const report = await doctorWorkspace(workspaceRoot);
    expect(report.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "WORKTREE_PRUNABLE" })]),
    );

    const fixed = await doctorWorkspace(workspaceRoot, createCommandContext(), { fix: true });
    expect(fixed.issues.map((issue) => issue.code)).not.toContain("WORKTREE_PRUNABLE");
    expect(fixed.fixes).toEqual([expect.objectContaining({ code: "WORKTREE_PRUNABLE" })]);
    expect(await git(foodsClone, ["worktree", "list"])).not.toContain("deleted-worktree");
  });
});
