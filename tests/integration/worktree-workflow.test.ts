import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { GitAdapter } from "../../src/adapters/git/git-adapter.js";
import { createCommandContext, type GitCommandAdapter } from "../../src/core/command-context.js";
import { doctorWorkspace } from "../../src/core/commands.js";
import {
  createTaskWorktree,
  getTaskWorktreePath,
  listTaskWorktrees,
  openTaskWorktree,
  pruneTaskWorktrees,
  removeTaskWorktree,
} from "../../src/core/commands/execution.js";
import type { EditorLaunch } from "../../src/core/execution/editor-launch.js";
import { ForgeUnavailableError, type ForgeClient } from "../../src/adapters/forge/github-forge.js";
import {
  branchExists,
  commitAndPushTaskWork,
  createLifecycleWorkspace,
  git,
} from "../utils/worktree-workspace.js";

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

/** A forge that knows the given merged pull requests, keyed by head branch. */
function createFakeForge(merged: Record<string, number>): {
  client: ForgeClient;
  lookups: Array<{ branch: string; remoteUrl: string }>;
} {
  const lookups: Array<{ branch: string; remoteUrl: string }> = [];
  return {
    lookups,
    client: {
      findMergedPullRequest: async (remoteUrl, branch) => {
        lookups.push({ branch, remoteUrl });
        return merged[branch] === undefined ? undefined : { number: merged[branch] };
      },
    },
  };
}

/** A task whose foods branch was pushed, then deleted on the remote without being merged there. */
async function createGoneTask(
  workspaceRoot: string,
  name: string,
): Promise<{ branch: string; root: string }> {
  const task = await createTaskWorktree(workspaceRoot, name, { repos: ["foods"] });
  const branch = await commitAndPushTaskWork(task.root, `${name}.txt`);
  await git(path.join(task.root, "repos", "foods"), ["push", "origin", "--delete", branch]);
  return { branch, root: task.root };
}

describe("forge-backed integration", () => {
  test("a gone branch whose pull request was merged is prunable, with the pull request", async () => {
    const { remotes, workspaceRoot } = await createLifecycleWorkspace();
    const { branch, root } = await createGoneTask(workspaceRoot, "merged-elsewhere");
    const forge = createFakeForge({ [branch]: 2028 });
    const context = createCommandContext({ forgeClients: { github: forge.client } });

    const listed = await listTaskWorktrees(
      workspaceRoot,
      { status: true, forge: "github" },
      context,
    );
    expect(listed.worktrees[0]?.prunable).toBe(true);
    expect(listed.worktrees[0]?.checkouts?.[1]).toMatchObject({
      name: "foods",
      upstream: "gone",
      integrated: true,
      integratedBy: "forge",
      pr: 2028,
    });
    expect(forge.lookups).toEqual([{ branch, remoteUrl: remotes.foods }]);

    const report = await pruneTaskWorktrees(workspaceRoot, { forge: "github" }, context);

    expect(report.status).toBe("ok");
    expect(report.removed).toEqual(["merged-elsewhere"]);
    expect(report.mergedPullRequests).toEqual([
      { item: "merged-elsewhere", checkout: "foods", pr: 2028 },
    ]);
    expect(existsSync(root)).toBe(false);
  });

  test("a gone branch without a merged pull request is kept", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const { root } = await createGoneTask(workspaceRoot, "abandoned");
    const forge = createFakeForge({});

    const report = await pruneTaskWorktrees(
      workspaceRoot,
      { forge: "github" },
      createCommandContext({ forgeClients: { github: forge.client } }),
    );

    expect(report.removed).toEqual([]);
    expect(report.kept).toEqual([
      {
        name: "abandoned",
        reasons: ["1 local-only commit in foods (upstream gone; --include-gone prunes it)"],
      },
    ]);
    expect(existsSync(root)).toBe(true);
  });

  test("an unavailable forge is a warning, and the verdict falls back to Git", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const { root } = await createGoneTask(workspaceRoot, "offline");
    const client: ForgeClient = {
      findMergedPullRequest: async () => {
        throw new ForgeUnavailableError("the GitHub CLI (gh) is not installed");
      },
    };

    const report = await pruneTaskWorktrees(
      workspaceRoot,
      { forge: "github" },
      createCommandContext({ forgeClients: { github: client } }),
    );

    expect(report.status).toBe("warning");
    expect(report.issues).toEqual([expect.objectContaining({ code: "FORGE_UNAVAILABLE" })]);
    expect(report.kept.map((item) => item.name)).toEqual(["offline"]);
    expect(existsSync(root)).toBe(true);
  });

  test("spec.execution.worktrees.forge turns the lookup on, and --forge none off", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace({ executionLines: ["forge: github"] });
    const { branch } = await createGoneTask(workspaceRoot, "configured");
    const forge = createFakeForge({ [branch]: 7 });
    const context = createCommandContext({ forgeClients: { github: forge.client } });

    const off = await pruneTaskWorktrees(workspaceRoot, { forge: "none", dryRun: true }, context);
    expect(off.removed).toEqual([]);
    expect(forge.lookups).toEqual([]);

    const on = await pruneTaskWorktrees(workspaceRoot, { dryRun: true }, context);
    expect(on.removed).toEqual(["configured"]);
  });

  test("an orphan branch whose pull request was merged is deleted with --branches", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const { branch } = await createGoneTask(workspaceRoot, "orphaned");
    expect((await removeTaskWorktree(workspaceRoot, "orphaned")).status).toBe("ok");
    const forge = createFakeForge({ [branch]: 99 });

    const report = await pruneTaskWorktrees(
      workspaceRoot,
      { branches: true, forge: "github" },
      createCommandContext({ forgeClients: { github: forge.client } }),
    );

    expect(report.deletedBranches).toEqual(expect.arrayContaining([{ name: "foods", branch }]));
    expect(report.mergedPullRequests).toEqual([{ item: branch, checkout: "foods", pr: 99 }]);
    expect(await branchExists(path.join(workspaceRoot, "repos", "foods"), branch)).toBe(false);
  });
});

describe("worktree path and open", () => {
  function recordingLauncher(): {
    context: ReturnType<typeof createCommandContext>;
    launches: EditorLaunch[];
  } {
    const launches: EditorLaunch[] = [];
    return {
      launches,
      context: createCommandContext({
        launchEditor: async (launch) => {
          launches.push(launch);
        },
      }),
    };
  }

  test("path prints the task root, @root the main workspace, and an unknown task fails", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const task = await createTaskWorktree(workspaceRoot, "a", { repos: ["foods"] });

    expect((await getTaskWorktreePath(workspaceRoot, "a")).root).toBe(task.root);
    expect((await getTaskWorktreePath(workspaceRoot, "@root")).root).toBe(workspaceRoot);
    const missing = await getTaskWorktreePath(workspaceRoot, "ghost");
    expect(missing.status).toBe("error");
    expect(missing.issues.map((issue) => issue.code)).toEqual(["WORKTREE_NOT_FOUND"]);
  });

  test("resolves the workspace from any directory inside it, a task's repositories included", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const task = await createTaskWorktree(workspaceRoot, "deep", { repos: ["foods"] });

    const fromClone = await getTaskWorktreePath(path.join(workspaceRoot, "repos", "foods"), "deep");
    const fromTaskRepo = await getTaskWorktreePath(path.join(task.root, "repos", "foods"), "@root");

    expect(fromClone.root).toBe(task.root);
    expect(await realpath(fromTaskRepo.root)).toBe(await realpath(workspaceRoot));
  });

  test("without a task, the picker chooses from @root and the task rows; without one, the task is required", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const task = await createTaskWorktree(workspaceRoot, "picked", { repos: ["foods"] });
    let offered: string[] = [];

    const picked = await getTaskWorktreePath(workspaceRoot, undefined, {
      pick: async (rows) => {
        offered = rows.map((row) => `${row.name} ${row.repos} ${row.prunable}`);
        return rows[1]?.name;
      },
    });
    const required = await getTaskWorktreePath(workspaceRoot, undefined);

    expect(offered).toEqual(["@root all -", "picked foods yes"]);
    expect(picked.root).toBe(task.root);
    expect(required.status).toBe("error");
    expect(required.issues.map((issue) => issue.code)).toEqual(["TASK_REQUIRED"]);
  });

  test("create writes a task editor workspace file listing only the task's repositories", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const task = await createTaskWorktree(workspaceRoot, "narrow", { repos: ["platform-api"] });

    const workspaceFile = JSON.parse(
      await readFile(path.join(task.root, "narrow.code-workspace"), "utf8"),
    ) as { folders: Array<{ name: string; path: string }> };

    expect(workspaceFile.folders).toEqual([
      { name: "lifecycle", path: "." },
      { name: "platform-api", path: "repos/platform-api" },
    ]);
    // The generated file does not make the task dirty.
    expect((await removeTaskWorktree(workspaceRoot, "narrow")).status).toBe("ok");
  });

  test("open launches the editor on the task workspace file, then reports the root", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const task = await createTaskWorktree(workspaceRoot, "edit", { repos: ["foods"] });
    const { context, launches } = recordingLauncher();

    const report = await openTaskWorktree(
      workspaceRoot,
      "edit",
      { editor: "cursor", env: {}, platform: "linux" },
      context,
    );

    expect(report).toMatchObject({ status: "ok", root: task.root, editor: "cursor" });
    expect(launches).toEqual([
      { command: "cursor", args: [path.join(task.root, "edit.code-workspace")] },
    ]);
  });

  test("open --create creates a missing task first; without it the task must exist", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const { context, launches } = recordingLauncher();

    const refused = await openTaskWorktree(workspaceRoot, "new-one", { editor: "none" }, context);
    const created = await openTaskWorktree(
      workspaceRoot,
      "new-one",
      { create: true, editor: "none" },
      context,
    );

    expect(refused.issues.map((issue) => issue.code)).toEqual(["WORKTREE_NOT_FOUND"]);
    expect(created.status).toBe("ok");
    expect(created.created?.status).toBe("ok");
    expect(existsSync(path.join(created.root, "repos", "foods", ".git"))).toBe(true);
    expect(launches).toEqual([]);
  });

  test("an editor that cannot be launched is EDITOR_UNAVAILABLE, naming the command", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    await createTaskWorktree(workspaceRoot, "no-editor", { repos: ["foods"] });

    const report = await openTaskWorktree(
      workspaceRoot,
      "no-editor",
      { editor: "vscode", env: {}, platform: "darwin" },
      createCommandContext({
        launchEditor: async () => {
          throw new Error("Unable to find application named 'Visual Studio Code'");
        },
      }),
    );

    expect(report.status).toBe("error");
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: "EDITOR_UNAVAILABLE",
        message: expect.stringContaining("open -a 'Visual Studio Code'"),
      }),
    ]);
  });
});

describe("compact list --status", () => {
  test("@root comes under root, never under worktrees, with the primary clones", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    await createTaskWorktree(workspaceRoot, "a", { repos: ["foods"] });
    await writeFile(path.join(workspaceRoot, "repos", "foods", "LOCAL.txt"), "x\n", "utf8");

    const report = await listTaskWorktrees(workspaceRoot, { status: true });

    expect(report.worktrees.map((worktree) => worktree.name)).toEqual(["a"]);
    expect(report.root?.checkouts.map((checkout) => [checkout.name, checkout.dirty])).toEqual([
      ["lifecycle", false],
      ["foods", true],
      ["platform-api", false],
    ]);
    expect((await listTaskWorktrees(workspaceRoot)).root).toBeUndefined();
  });

  test("a list column gets the task names on stdin and its values land in the rows", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace({
      executionLines: [
        "listColumns:",
        "  - name: PLATFORM",
        `    command: 'tee columns-stdin.txt | while read -r task; do [ "$task" = a ] && printf "%s\\tup\\n" "$task"; done; true'`,
      ],
    });
    await createTaskWorktree(workspaceRoot, "a", { repos: ["foods"] });
    await createTaskWorktree(workspaceRoot, "b", { repos: ["foods"] });

    const report = await listTaskWorktrees(workspaceRoot, { status: true });

    expect(report.status).toBe("ok");
    expect(await readFile(path.join(workspaceRoot, "columns-stdin.txt"), "utf8")).toBe(
      "@root\na\nb\n",
    );
    expect(report.root?.columns).toEqual({ PLATFORM: "-" });
    expect(report.worktrees.map((worktree) => [worktree.name, worktree.columns])).toEqual([
      ["a", { PLATFORM: "up" }],
      ["b", { PLATFORM: "-" }],
    ]);
  });

  test("a list column that runs too long shows ? with a warning", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace({
      executionLines: ["listColumns:", "  - name: SLOW", "    command: sleep 5"],
    });
    await createTaskWorktree(workspaceRoot, "a", { repos: ["foods"] });

    const report = await listTaskWorktrees(workspaceRoot, { status: true, columnTimeoutMs: 300 });

    expect(report.status).toBe("warning");
    expect(report.issues).toEqual([expect.objectContaining({ code: "LIST_COLUMN_TIMEOUT" })]);
    expect(report.worktrees[0]?.columns).toEqual({ SLOW: "?" });
    expect(report.root?.columns).toEqual({ SLOW: "?" });
  });
});
