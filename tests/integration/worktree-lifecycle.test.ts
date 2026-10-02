import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  createTaskWorktree,
  listTaskWorktrees,
  pruneTaskWorktrees,
  removeTaskWorktree,
} from "../../src/core/commands/execution.js";
import {
  branchExists,
  commitAndPushTaskWork,
  createLifecycleWorkspace,
  git,
  pushCommitToRemote,
  readTaskMetadata,
  squashMergeOnRemote,
} from "../utils/worktree-workspace.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

describe("worktree remove keeps uncommitted work", () => {
  test("a dirty repository leaves the whole task untouched and exits with an error", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const created = await createTaskWorktree(workspaceRoot, "rm-probe");
    const unsavedFile = path.join(created.root, "repos", "foods", "UNSAVED.txt");
    await writeFile(unsavedFile, "important\n", "utf8");

    const report = await removeTaskWorktree(workspaceRoot, "rm-probe");

    expect(report.status).toBe("error");
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: "WORKTREE_DIRTY",
        path: path.join(created.root, "repos", "foods"),
        changedFiles: 1,
      }),
    ]);
    expect(await readFile(unsavedFile, "utf8")).toBe("important\n");
    expect(existsSync(path.join(created.root, "repos", "platform-api", ".git"))).toBe(true);
    expect(existsSync(path.join(created.root, ".git"))).toBe(true);
  });

  test("a modified tracked file in the workspace-root worktree counts as dirty", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const created = await createTaskWorktree(workspaceRoot, "root-dirty");
    await writeFile(path.join(created.root, "maestro.yaml"), "# edited\n", "utf8");

    const report = await removeTaskWorktree(workspaceRoot, "root-dirty");

    expect(report.status).toBe("error");
    expect(report.issues.map((issue) => issue.path)).toEqual([created.root]);
    expect(existsSync(created.root)).toBe(true);
  });

  test("ignored files do not block the removal", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const created = await createTaskWorktree(workspaceRoot, "ignored-only");
    const vendorDir = path.join(created.root, "repos", "foods", "vendor");
    await mkdir(vendorDir, { recursive: true });
    await writeFile(path.join(vendorDir, "autoload.php"), "<?php\n", "utf8");

    const report = await removeTaskWorktree(workspaceRoot, "ignored-only");

    expect(report.status).toBe("ok");
    expect(existsSync(created.root)).toBe(false);
    expect(
      await git(path.join(workspaceRoot, "repos", "foods"), ["worktree", "list"]),
    ).not.toContain("ignored-only");
  });

  test("--force discards the uncommitted work", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const created = await createTaskWorktree(workspaceRoot, "force-probe");
    await writeFile(path.join(created.root, "repos", "foods", "UNSAVED.txt"), "x\n", "utf8");

    const report = await removeTaskWorktree(workspaceRoot, "force-probe", { force: true });

    expect(report.status).toBe("ok");
    expect(existsSync(created.root)).toBe(false);
  });
});

describe("worktree create keeps existing task branches", () => {
  test("create, commit, remove, create again keeps the commit as the branch tip", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const first = await createTaskWorktree(workspaceRoot, "reset-probe");
    const foodsWorktree = path.join(first.root, "repos", "foods");
    await git(foodsWorktree, ["commit", "--allow-empty", "-m", "probe commit"]);
    await git(first.root, ["commit", "--allow-empty", "-m", "root probe commit"]);
    const foodsTip = await git(foodsWorktree, ["rev-parse", "HEAD"]);
    const rootTip = await git(first.root, ["rev-parse", "HEAD"]);

    expect((await removeTaskWorktree(workspaceRoot, "reset-probe")).status).toBe("ok");
    const second = await createTaskWorktree(workspaceRoot, "reset-probe");

    expect(second.status).toBe("ok");
    expect(second.repositories.find((entry) => entry.name === "foods")?.status).toBe("reused");
    expect(await git(foodsWorktree, ["rev-parse", "HEAD"])).toBe(foodsTip);
    expect(await git(foodsWorktree, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
      "platform/reset-probe/foods",
    );
    expect(await git(second.root, ["rev-parse", "HEAD"])).toBe(rootTip);
  });

  test("a new task branch starts from the reference branch", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();

    const report = await createTaskWorktree(workspaceRoot, "fresh");

    expect(report.repositories.map((entry) => entry.status)).toEqual(["created", "created"]);
    expect(await git(path.join(report.root, "repos", "foods"), ["rev-parse", "HEAD"])).toBe(
      await git(path.join(workspaceRoot, "repos", "foods"), ["rev-parse", "main"]),
    );
  });
});

describe("partial worktrees with --repos", () => {
  test("only the selected repositories get a worktree, and the metadata records them", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();

    const report = await createTaskWorktree(workspaceRoot, "one-repo", { repos: ["foods"] });

    expect(report.status).toBe("ok");
    expect(report.repositories.map((entry) => entry.name)).toEqual(["foods"]);
    expect(existsSync(path.join(report.root, "repos", "foods", ".git"))).toBe(true);
    expect(existsSync(path.join(report.root, "repos", "platform-api"))).toBe(false);
    expect((await readTaskMetadata(report.root)).repositories).toEqual(["foods"]);
    const descriptor = JSON.parse(
      await readFile(path.join(report.root, "maestro.json"), "utf8"),
    ) as {
      repositories: Array<{ name: string }>;
    };
    expect(descriptor.repositories.map((entry) => entry.name)).toEqual(["foods"]);
  });

  test("a second create --repos adds a repository and a remove removes both and nothing else", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const first = await createTaskWorktree(workspaceRoot, "grow", { repos: ["foods"] });
    await git(path.join(first.root, "repos", "foods"), ["commit", "--allow-empty", "-m", "wip"]);
    const foodsTip = await git(path.join(first.root, "repos", "foods"), ["rev-parse", "HEAD"]);
    const other = await createTaskWorktree(workspaceRoot, "other", { repos: ["platform-api"] });

    const second = await createTaskWorktree(workspaceRoot, "grow", { repos: ["platform-api"] });

    expect(second.repositories.map((entry) => entry.name)).toEqual(["platform-api"]);
    expect(await git(path.join(first.root, "repos", "foods"), ["rev-parse", "HEAD"])).toBe(
      foodsTip,
    );
    expect((await readTaskMetadata(first.root)).repositories).toEqual(["foods", "platform-api"]);
    expect((await listTaskWorktrees(workspaceRoot)).worktrees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "grow", repositories: ["foods", "platform-api"] }),
      ]),
    );

    const removed = await removeTaskWorktree(workspaceRoot, "grow");

    expect(removed.status).toBe("ok");
    expect(removed.repositories.map((entry) => [entry.name, entry.status])).toEqual([
      ["foods", "removed"],
      ["platform-api", "removed"],
    ]);
    expect(existsSync(first.root)).toBe(false);
    expect(existsSync(path.join(other.root, "repos", "platform-api", ".git"))).toBe(true);
  });

  test("an unknown repository fails the command and creates nothing", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();

    const report = await createTaskWorktree(workspaceRoot, "typo", { repos: ["foods", "fods"] });

    expect(report.status).toBe("error");
    expect(report.issues).toEqual([expect.objectContaining({ code: "REPO_UNKNOWN" })]);
    expect(existsSync(report.root)).toBe(false);
  });

  test("remove falls back to the directories under repos/ for metadata without the list", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    // Metadata written by 0.6: no repository list, no generated-file fingerprints.
    const created = await createTaskWorktree(workspaceRoot, "legacy");
    await writeFile(
      path.join(created.root, ".maestro", "execution", "worktree.json"),
      JSON.stringify({ name: "legacy", createdAt: "2026-01-01T00:00:00.000Z" }),
      "utf8",
    );

    const removed = await removeTaskWorktree(workspaceRoot, "legacy");

    expect(removed.issues).toEqual([]);
    expect(removed.repositories.map((entry) => entry.name)).toEqual(["foods", "platform-api"]);
    expect(existsSync(created.root)).toBe(false);
  });

  test("files Maestro wrote into the task root only count once they are edited", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    // The narrowed descriptor differs from the committed maestro.json.
    const created = await createTaskWorktree(workspaceRoot, "generated", { repos: ["foods"] });
    expect(await git(created.root, ["status", "--porcelain"])).toContain("maestro.json");

    await writeFile(path.join(created.root, "maestro.json"), "{}\n", "utf8");
    const refused = await removeTaskWorktree(workspaceRoot, "generated");
    expect(refused.issues).toEqual([
      expect.objectContaining({ code: "WORKTREE_DIRTY", path: created.root, changedFiles: 1 }),
    ]);

    await createTaskWorktree(workspaceRoot, "generated", { repos: ["foods"] });
    const removed = await removeTaskWorktree(workspaceRoot, "generated");
    expect(removed.issues).toEqual([]);
    expect(removed.status).toBe("ok");
    expect(existsSync(created.root)).toBe(false);
  });
});

describe("base refs", () => {
  test("a new repository task branch starts from the freshly fetched origin branch", async () => {
    const { remotes, root, workspaceRoot } = await createLifecycleWorkspace();
    const remoteTip = await pushCommitToRemote(root, remotes.foods, "landed upstream");
    const localMain = await git(path.join(workspaceRoot, "repos", "foods"), ["rev-parse", "main"]);

    const report = await createTaskWorktree(workspaceRoot, "fresh-base", { repos: ["foods"] });

    expect(report.status).toBe("ok");
    expect(await git(path.join(report.root, "repos", "foods"), ["rev-parse", "HEAD"])).toBe(
      remoteTip,
    );
    // The primary clone's checked-out branch is not moved.
    expect(await git(path.join(workspaceRoot, "repos", "foods"), ["rev-parse", "main"])).toBe(
      localMain,
    );
  });

  test("--offline keeps the local reference branch", async () => {
    const { remotes, root, workspaceRoot } = await createLifecycleWorkspace();
    await pushCommitToRemote(root, remotes.foods, "landed upstream");
    const localMain = await git(path.join(workspaceRoot, "repos", "foods"), ["rev-parse", "main"]);

    const report = await createTaskWorktree(workspaceRoot, "offline", {
      repos: ["foods"],
      offline: true,
    });

    expect(await git(path.join(report.root, "repos", "foods"), ["rev-parse", "HEAD"])).toBe(
      localMain,
    );
  });

  test("a fetch failure is a warning and the local reference branch is used", async () => {
    const { root, workspaceRoot } = await createLifecycleWorkspace();
    const foodsClone = path.join(workspaceRoot, "repos", "foods");
    await git(foodsClone, ["remote", "set-url", "origin", path.join(root, "missing.git")]);

    const report = await createTaskWorktree(workspaceRoot, "no-network", { repos: ["foods"] });

    expect(report.status).toBe("warning");
    expect(report.issues).toEqual([expect.objectContaining({ code: "FETCH_FAILED" })]);
    expect(report.repositories.map((entry) => entry.status)).toEqual(["created"]);
  });

  test("a reused task branch is never moved to the new base", async () => {
    const { remotes, root, workspaceRoot } = await createLifecycleWorkspace();
    const first = await createTaskWorktree(workspaceRoot, "keep", { repos: ["foods"] });
    const taskTip = await git(path.join(first.root, "repos", "foods"), ["rev-parse", "HEAD"]);
    await removeTaskWorktree(workspaceRoot, "keep");
    await pushCommitToRemote(root, remotes.foods, "landed upstream");

    const second = await createTaskWorktree(workspaceRoot, "keep", { repos: ["foods"] });

    expect(second.repositories.map((entry) => entry.status)).toEqual(["reused"]);
    expect(await git(path.join(second.root, "repos", "foods"), ["rev-parse", "HEAD"])).toBe(
      taskTip,
    );
  });

  test("the workspace-root task branch starts from the default branch, not the current one", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const mainTip = await git(workspaceRoot, ["rev-parse", "main"]);
    await git(workspaceRoot, ["switch", "-c", "feature/local"]);
    await git(workspaceRoot, ["commit", "--allow-empty", "-m", "feature work"]);

    const report = await createTaskWorktree(workspaceRoot, "from-feature", { repos: ["foods"] });

    expect(await git(report.root, ["rev-parse", "HEAD"])).toBe(mainTip);
  });
});

describe("running from inside a task worktree", () => {
  test("create resolves the main workspace instead of nesting worktrees under the task", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const outer = await createTaskWorktree(workspaceRoot, "outer", { repos: ["foods"] });

    const inner = await createTaskWorktree(outer.root, "inner", { repos: ["foods"] });

    expect(inner.status).toBe("ok");
    expect(inner.issues[0]).toMatchObject({ code: "WORKSPACE_RESOLVED_FROM_TASK" });
    expect(await realpath(path.dirname(inner.root))).toBe(
      await realpath(path.join(workspaceRoot, "worktrees")),
    );
    expect(existsSync(path.join(outer.root, "worktrees"))).toBe(false);

    const listed = await listTaskWorktrees(outer.root);
    expect(listed.worktrees.map((entry) => entry.name).sort()).toEqual(["inner", "outer"]);

    const removed = await removeTaskWorktree(outer.root, "inner");
    expect(removed.status).toBe("ok");
    expect(existsSync(inner.root)).toBe(false);
  });

  test("fails with WORKSPACE_IS_TASK_WORKTREE when the main workspace cannot be resolved", async () => {
    const root = await createManagedTempDir("maestro-orphan-task-");
    await mkdir(path.join(root, ".maestro", "execution"), { recursive: true });
    await writeFile(path.join(root, ".maestro", "execution", "worktree.json"), "{}", "utf8");

    const report = await createTaskWorktree(root, "nested");

    expect(report.status).toBe("error");
    expect(report.issues).toEqual([
      expect.objectContaining({ code: "WORKSPACE_IS_TASK_WORKTREE" }),
    ]);
    expect(existsSync(path.join(root, "worktrees"))).toBe(false);
  });
});

describe("worktree prune", () => {
  test("an untouched task is pruned along with its task branches", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const task = await createTaskWorktree(workspaceRoot, "untouched");
    const foodsClone = path.join(workspaceRoot, "repos", "foods");

    const report = await pruneTaskWorktrees(workspaceRoot);

    expect(report.status).toBe("ok");
    expect(report.removed).toEqual(["untouched"]);
    expect(report.deletedBranches).toEqual(
      expect.arrayContaining([
        { name: "lifecycle", branch: "platform/untouched/lifecycle" },
        { name: "foods", branch: "platform/untouched/foods" },
        { name: "platform-api", branch: "platform/untouched/platform-api" },
      ]),
    );
    expect(existsSync(task.root)).toBe(false);
    expect(await branchExists(foodsClone, "platform/untouched/foods")).toBe(false);
    expect(await branchExists(workspaceRoot, "platform/untouched/lifecycle")).toBe(false);
    expect(await git(foodsClone, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main");
  });

  test("a squash-merged task branch is integrated by patch: pruned and its branch deleted", async () => {
    const { remotes, root, workspaceRoot } = await createLifecycleWorkspace();
    const task = await createTaskWorktree(workspaceRoot, "squashed", { repos: ["foods"] });
    const branch = await commitAndPushTaskWork(task.root, "feature.txt");
    await squashMergeOnRemote(root, remotes.foods, branch);

    const listed = await listTaskWorktrees(workspaceRoot, { status: true });
    // fetch has not run yet: list --status does not fetch.
    expect(listed.worktrees[0]?.checkouts?.map((checkout) => checkout.name)).toEqual([
      "lifecycle",
      "foods",
    ]);

    const report = await pruneTaskWorktrees(workspaceRoot);

    expect(report.removed).toEqual(["squashed"]);
    expect(report.deletedBranches).toEqual(expect.arrayContaining([{ name: "foods", branch }]));
    expect(existsSync(task.root)).toBe(false);
    expect(await branchExists(path.join(workspaceRoot, "repos", "foods"), branch)).toBe(false);
  });

  test("list --status reports the checkout state after a squash merge", async () => {
    const { remotes, root, workspaceRoot } = await createLifecycleWorkspace();
    const task = await createTaskWorktree(workspaceRoot, "state", { repos: ["foods"] });
    const branch = await commitAndPushTaskWork(task.root, "feature.txt");
    await squashMergeOnRemote(root, remotes.foods, branch);
    await git(path.join(workspaceRoot, "repos", "foods"), ["fetch", "--prune"]);

    const listed = await listTaskWorktrees(workspaceRoot, { status: true });

    expect(listed.worktrees[0]?.prunable).toBe(true);
    expect(listed.worktrees[0]?.checkouts?.[1]).toMatchObject({
      name: "foods",
      branch,
      dirty: false,
      localOnly: 1,
      upstream: "gone",
      integrated: true,
    });
  });

  test("a dirty task is kept with its reason", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const task = await createTaskWorktree(workspaceRoot, "dirty");
    await writeFile(path.join(task.root, "repos", "foods", "WIP.txt"), "wip\n", "utf8");

    const report = await pruneTaskWorktrees(workspaceRoot);

    expect(report.removed).toEqual([]);
    expect(report.kept).toEqual([{ name: "dirty", reasons: ["dirty: foods"] }]);
    expect(existsSync(path.join(task.root, "repos", "foods", "WIP.txt"))).toBe(true);
  });

  test("an unpushed commit keeps the task", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const task = await createTaskWorktree(workspaceRoot, "unpushed", { repos: ["platform-api"] });
    await git(path.join(task.root, "repos", "platform-api"), [
      "commit",
      "--allow-empty",
      "-m",
      "a",
    ]);
    await git(path.join(task.root, "repos", "platform-api"), [
      "commit",
      "--allow-empty",
      "-m",
      "b",
    ]);

    const report = await pruneTaskWorktrees(workspaceRoot);

    expect(report.kept).toEqual([
      { name: "unpushed", reasons: ["2 local-only commits in platform-api"] },
    ]);
    expect(existsSync(task.root)).toBe(true);
  });

  test("a gone but unintegrated branch is kept, and pruned with --include-gone", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const task = await createTaskWorktree(workspaceRoot, "gone", { repos: ["foods"] });
    const branch = await commitAndPushTaskWork(task.root, "abandoned.txt");
    await git(path.join(task.root, "repos", "foods"), ["push", "origin", "--delete", branch]);

    const kept = await pruneTaskWorktrees(workspaceRoot);
    expect(kept.kept).toEqual([
      {
        name: "gone",
        reasons: ["1 local-only commit in foods (upstream gone; --include-gone prunes it)"],
      },
    ]);
    expect(existsSync(task.root)).toBe(true);

    const pruned = await pruneTaskWorktrees(workspaceRoot, { includeGone: true });
    expect(pruned.removed).toEqual(["gone"]);
    expect(existsSync(task.root)).toBe(false);
  });

  test("--branches deletes an integrated orphan branch and keeps one with unique commits", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const foodsClone = path.join(workspaceRoot, "repos", "foods");
    await git(foodsClone, ["branch", "platform/old/foods", "main"]);
    await git(foodsClone, ["switch", "-c", "platform/wip/foods"]);
    await git(foodsClone, ["commit", "--allow-empty", "-m", "unique"]);
    await git(foodsClone, ["switch", "main"]);

    const withoutFlag = await pruneTaskWorktrees(workspaceRoot);
    expect(withoutFlag.deletedBranches).toEqual([]);

    const report = await pruneTaskWorktrees(workspaceRoot, { branches: true });

    expect(report.deletedBranches).toEqual([{ name: "foods", branch: "platform/old/foods" }]);
    expect(report.kept).toEqual([
      { name: "platform/wip/foods", reasons: ["1 local-only commit in foods"] },
    ]);
    expect(await branchExists(foodsClone, "platform/old/foods")).toBe(false);
    expect(await branchExists(foodsClone, "platform/wip/foods")).toBe(true);
  });

  test("--dry-run prints the plan and writes nothing", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const task = await createTaskWorktree(workspaceRoot, "planned", { repos: ["foods"] });
    const foodsClone = path.join(workspaceRoot, "repos", "foods");
    await git(foodsClone, ["branch", "platform/orphan/foods", "main"]);

    const report = await pruneTaskWorktrees(workspaceRoot, { dryRun: true, branches: true });

    expect(report.dryRun).toBe(true);
    expect(report.removed).toEqual(["planned"]);
    expect(report.deletedBranches).toEqual(
      expect.arrayContaining([
        { name: "foods", branch: "platform/planned/foods" },
        { name: "foods", branch: "platform/orphan/foods" },
      ]),
    );
    expect(existsSync(path.join(task.root, "repos", "foods", ".git"))).toBe(true);
    expect(await branchExists(foodsClone, "platform/planned/foods")).toBe(true);
    expect(await branchExists(foodsClone, "platform/orphan/foods")).toBe(true);
  });
});
