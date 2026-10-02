import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { execa } from "execa";
import { describe, expect, test } from "vitest";
import { GitAdapter } from "../../src/adapters/git/git-adapter.js";
import { GitCheckoutInspector } from "../../src/adapters/git/internal/git-checkout-inspector.js";
import { createCommandContext, type GitCommandAdapter } from "../../src/core/command-context.js";
import { createTaskWorktree, pruneTaskWorktrees } from "../../src/core/commands/execution.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";
import { branchExists, createLifecycleWorkspace, git } from "../utils/worktree-workspace.js";

/** A repository with `integrated` branches at main's tip and `unlanded` ones with a unique commit. */
async function createBranchRepository(counts: { integrated: number; unlanded: number }) {
  const root = await createManagedTempDir("maestro-branches-");
  await git(root, ["init", "--initial-branch=main"]);
  await writeFile(path.join(root, "README.md"), "# repo\n", "utf8");
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", "init"]);
  const head = await git(root, ["rev-parse", "HEAD"]);
  const updates = Array.from(
    { length: counts.integrated },
    (_, index) => `create refs/heads/platform/done-${index}/repo ${head}\n`,
  ).join("");
  await execa("git", ["update-ref", "--stdin"], { cwd: root, input: updates });
  for (let index = 0; index < counts.unlanded; index += 1) {
    await git(root, ["switch", "-c", `platform/wip-${index}/repo`, "main"]);
    await git(root, ["commit", "--allow-empty", "-m", `wip ${index}`]);
  }
  await git(root, ["switch", "main"]);
  return root;
}

function countingInspector(): { calls: () => number; inspector: GitCheckoutInspector } {
  let calls = 0;
  const inspector = new GitCheckoutInspector(async (repoRoot, args) => {
    calls += 1;
    const { exitCode, stderr, stdout } = await execa("git", args, { cwd: repoRoot, reject: false });
    return { exitCode, stderr: String(stderr), stdout: String(stdout) };
  });
  return { calls: () => calls, inspector };
}

describe("batched task branch inspection", () => {
  test("the number of git invocations does not grow with integrated branches", async () => {
    const small = await createBranchRepository({ integrated: 3, unlanded: 2 });
    const large = await createBranchRepository({ integrated: 60, unlanded: 2 });
    const smallRun = countingInspector();
    const largeRun = countingInspector();

    const smallStates = await smallRun.inspector.inspectTaskBranches(small, "platform", "main");
    const largeStates = await largeRun.inspector.inspectTaskBranches(large, "platform", "main");

    expect(largeStates).toHaveLength(62);
    expect(largeStates.filter((state) => state.integrated)).toHaveLength(60);
    expect(largeStates.filter((state) => state.localOnly > 0).map((state) => state.branch)).toEqual(
      ["platform/wip-0/repo", "platform/wip-1/repo"],
    );
    expect(smallStates).toHaveLength(5);
    // One listing, one --merged pass, then a fixed number per unlanded branch.
    expect(largeRun.calls()).toBe(smallRun.calls());
    expect(largeRun.calls()).toBeLessThanOrEqual(2 + 5 * 2);
  });

  test("deleteBranches deletes in chunks and reports the branches Git refused", async () => {
    const root = await createBranchRepository({ integrated: 1500, unlanded: 0 });
    const checkedOut = path.join(root, "..", `checked-out-${path.basename(root)}`);
    await mkdir(path.dirname(checkedOut), { recursive: true });
    await git(root, ["worktree", "add", checkedOut, "platform/done-7/repo"]);
    const branches = Array.from({ length: 1500 }, (_, index) => `platform/done-${index}/repo`);

    const { deleted, failed } = await new GitAdapter().deleteBranches(root, branches);

    expect(failed).toEqual([{ branch: "platform/done-7/repo", message: expect.any(String) }]);
    expect(deleted).toHaveLength(1499);
    expect(
      await git(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads/platform/"]),
    ).toBe("platform/done-7/repo");
  });
});

describe("prune batches its Git work per repository", () => {
  test("one fetch, one branch inspection, and one deletion per repository", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    await createTaskWorktree(workspaceRoot, "a");
    await createTaskWorktree(workspaceRoot, "b");
    const foodsClone = path.join(workspaceRoot, "repos", "foods");
    for (let index = 0; index < 10; index += 1) {
      await git(foodsClone, ["branch", `platform/old-${index}/foods`, "main"]);
    }
    const real = new GitAdapter();
    const calls: Array<{ method: string; repoRoot: string; branches?: string[] }> = [];
    const adapter = new Proxy(real, {
      get(target, property, receiver) {
        const value: unknown = Reflect.get(target, property, receiver);
        if (typeof value !== "function") {
          return value;
        }
        const method = (value as (...args: unknown[]) => unknown).bind(target);
        return (repoRoot: string, ...rest: unknown[]) => {
          calls.push({
            method: String(property),
            repoRoot,
            ...(property === "deleteBranches" ? { branches: rest[0] as string[] } : {}),
          });
          return method(repoRoot, ...rest);
        };
      },
    }) as GitCommandAdapter;

    const report = await pruneTaskWorktrees(
      workspaceRoot,
      { branches: true },
      createCommandContext({ gitAdapter: adapter }),
    );
    const callsTo = (method: string) =>
      calls.filter((call) => call.method === method).map((call) => call.repoRoot);

    expect(report.removed.sort()).toEqual(["a", "b"]);
    expect(report.deletedBranches).toHaveLength(2 * 3 + 10);
    const sources = [workspaceRoot, foodsClone, path.join(workspaceRoot, "repos", "platform-api")];
    expect(callsTo("fetch").sort()).toEqual([...sources].sort());
    expect(callsTo("inspectTaskBranches").sort()).toEqual([...sources].sort());
    expect(callsTo("deleteBranches").sort()).toEqual([...sources].sort());
    expect(
      calls.find((call) => call.method === "deleteBranches" && call.repoRoot === foodsClone)
        ?.branches,
    ).toHaveLength(12);
    expect(await branchExists(foodsClone, "platform/old-3/foods")).toBe(false);
  });
});
