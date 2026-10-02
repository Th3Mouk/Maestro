import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { createCommandContext } from "../../src/core/command-context.js";
import {
  createTaskWorktree,
  pruneTaskWorktrees,
  removeTaskWorktree,
} from "../../src/core/commands/execution.js";
import { createLifecycleWorkspace } from "../utils/worktree-workspace.js";

function captureStderr(): {
  context: ReturnType<typeof createCommandContext>;
  output: () => string;
} {
  const chunks: string[] = [];
  const stderr = {
    isTTY: false,
    write: (chunk: string) => {
      chunks.push(chunk);
      return true;
    },
  } as unknown as NodeJS.WriteStream;
  return { context: createCommandContext({ stderr }), output: () => chunks.join("") };
}

/** Hooks that append one line per run to `hook-log.txt` in the main workspace. */
function hookLines(hooks: { postCreate?: string[]; preRemove?: string[] }): string[] {
  return [
    "hooks:",
    ...Object.entries(hooks).flatMap(([hook, commands]) => [
      `  ${hook}:`,
      ...commands.map((command) => `    - '${command}'`),
    ]),
  ];
}

const logRun = 'echo "$MAESTRO_HOOK $MAESTRO_TRIGGER $MAESTRO_TASK" >> hook-log.txt';

async function readHookLog(workspaceRoot: string): Promise<string[]> {
  const logPath = path.join(workspaceRoot, "hook-log.txt");
  if (!existsSync(logPath)) {
    return [];
  }
  return (await readFile(logPath, "utf8")).trim().split("\n");
}

describe("postCreate hooks", () => {
  test("run from the main workspace root with every MAESTRO_ variable", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace({
      executionLines: hookLines({ postCreate: ["env | grep ^MAESTRO_ | sort > hook-env.txt"] }),
    });
    const { context } = captureStderr();

    const report = await createTaskWorktree(workspaceRoot, "seeded", { repos: ["foods"] }, context);

    expect(report.status).toBe("ok");
    expect(report.hooks).toEqual([
      {
        hook: "postCreate",
        command: "env | grep ^MAESTRO_ | sort > hook-env.txt",
        status: "ok",
        exitCode: 0,
      },
    ]);
    const env = Object.fromEntries(
      (await readFile(path.join(workspaceRoot, "hook-env.txt"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => line.split("=") as [string, string]),
    );
    expect(env).toEqual({
      MAESTRO_HOOK: "postCreate",
      MAESTRO_TASK: "seeded",
      MAESTRO_TASK_REPOSITORIES: "foods",
      MAESTRO_TASK_ROOT: report.root,
      MAESTRO_TRIGGER: "create",
      MAESTRO_WORKSPACE_ROOT: workspaceRoot,
    });
  });

  test("a failure is a warning with the hook's stderr, and the worktree stays", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace({
      executionLines: hookLines({ postCreate: ["echo seeding; echo boom >&2; exit 3"] }),
    });
    const { context, output } = captureStderr();

    const report = await createTaskWorktree(workspaceRoot, "broken-seed", {}, context);

    expect(report.status).toBe("warning");
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: "HOOK_FAILED",
        message: expect.stringMatching(/failed \(exit 3\):\nboom$/),
      }),
    ]);
    expect(existsSync(path.join(report.root, "repos", "foods", ".git"))).toBe(true);
    expect(output()).toContain("[postCreate] seeding\n");
    expect(output()).toContain("[postCreate] boom\n");
  });

  test("run again only when create adds repositories to an existing task", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace({
      executionLines: hookLines({ postCreate: [logRun] }),
    });
    const { context } = captureStderr();

    await createTaskWorktree(workspaceRoot, "grow", { repos: ["foods"] }, context);
    await createTaskWorktree(workspaceRoot, "grow", { repos: ["foods"] }, context);
    await createTaskWorktree(workspaceRoot, "grow", { repos: ["platform-api"] }, context);

    expect(await readHookLog(workspaceRoot)).toEqual([
      "postCreate create grow",
      "postCreate create grow",
    ]);
  });

  test("--no-hooks skips them and --dry-run only plans them", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace({
      executionLines: hookLines({ postCreate: [logRun] }),
    });
    const { context } = captureStderr();

    const planned = await createTaskWorktree(workspaceRoot, "plan", { dryRun: true }, context);
    const skipped = await createTaskWorktree(workspaceRoot, "skip", { hooks: false }, context);

    expect(planned.hooks).toEqual([{ hook: "postCreate", command: logRun, status: "planned" }]);
    expect(skipped.hooks).toBeUndefined();
    expect(await readHookLog(workspaceRoot)).toEqual([]);
  });
});

describe("preRemove hooks", () => {
  test("a failure aborts the removal and leaves the task untouched", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace({
      executionLines: hookLines({ preRemove: ["exit 4"] }),
    });
    const { context } = captureStderr();
    const created = await createTaskWorktree(workspaceRoot, "guarded", {}, context);

    const report = await removeTaskWorktree(workspaceRoot, "guarded", {}, context);

    expect(report.status).toBe("error");
    expect(report.issues).toEqual([expect.objectContaining({ code: "HOOK_FAILED" })]);
    expect(report.repositories).toEqual([]);
    expect(existsSync(path.join(created.root, "repos", "foods", ".git"))).toBe(true);
    expect(existsSync(path.join(created.root, ".git"))).toBe(true);
  });

  test("never runs on a dirty task: the safety check comes first", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace({
      executionLines: hookLines({ preRemove: [logRun] }),
    });
    const { context } = captureStderr();
    const created = await createTaskWorktree(workspaceRoot, "dirty", {}, context);
    await writeFile(path.join(created.root, "repos", "foods", "WIP.txt"), "wip\n", "utf8");

    const report = await removeTaskWorktree(workspaceRoot, "dirty", {}, context);

    expect(report.status).toBe("error");
    expect(report.issues.map((issue) => issue.code)).toEqual(["WORKTREE_DIRTY"]);
    expect(await readHookLog(workspaceRoot)).toEqual([]);
  });

  test("runs before the removal, which then proceeds", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace({
      executionLines: hookLines({
        preRemove: [`test -d "$MAESTRO_TASK_ROOT/repos/foods" && ${logRun}`],
      }),
    });
    const { context } = captureStderr();
    const created = await createTaskWorktree(workspaceRoot, "teardown", {}, context);

    const report = await removeTaskWorktree(workspaceRoot, "teardown", {}, context);

    expect(report.status).toBe("ok");
    expect(await readHookLog(workspaceRoot)).toEqual(["preRemove remove teardown"]);
    expect(existsSync(created.root)).toBe(false);
  });

  test("--force still runs the hook, and its failure is only a warning", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace({
      executionLines: hookLines({ preRemove: [`${logRun}; exit 1`] }),
    });
    const { context } = captureStderr();
    const created = await createTaskWorktree(workspaceRoot, "forced", {}, context);

    const report = await removeTaskWorktree(workspaceRoot, "forced", { force: true }, context);

    expect(report.status).toBe("warning");
    expect(await readHookLog(workspaceRoot)).toEqual(["preRemove remove forced"]);
    expect(existsSync(created.root)).toBe(false);
  });

  test("prune runs it once per removed task, and only for those", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace({
      executionLines: hookLines({ preRemove: [logRun] }),
    });
    const { context } = captureStderr();
    await createTaskWorktree(workspaceRoot, "landed", { repos: ["foods"] }, context);
    const dirty = await createTaskWorktree(workspaceRoot, "busy", { repos: ["foods"] }, context);
    await writeFile(path.join(dirty.root, "repos", "foods", "WIP.txt"), "wip\n", "utf8");

    const planned = await pruneTaskWorktrees(workspaceRoot, { dryRun: true }, context);
    expect(planned.hooks).toEqual([
      { hook: "preRemove", command: logRun, status: "planned", task: "landed" },
    ]);
    expect(await readHookLog(workspaceRoot)).toEqual([]);

    const report = await pruneTaskWorktrees(workspaceRoot, {}, context);

    expect(report.removed).toEqual(["landed"]);
    expect(report.hooks).toEqual([
      { hook: "preRemove", command: logRun, status: "ok", exitCode: 0, task: "landed" },
    ]);
    expect(await readHookLog(workspaceRoot)).toEqual(["preRemove prune landed"]);
  });

  test("prune keeps a task whose hook fails, with the reason", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace({
      executionLines: hookLines({ preRemove: ["exit 2"] }),
    });
    const { context } = captureStderr();
    const created = await createTaskWorktree(workspaceRoot, "refused", {}, context);

    const report = await pruneTaskWorktrees(workspaceRoot, {}, context);

    expect(report.removed).toEqual([]);
    expect(report.kept).toEqual([{ name: "refused", reasons: ["preRemove hook failed (exit 2)"] }]);
    expect(existsSync(path.join(created.root, "repos", "foods", ".git"))).toBe(true);
  });

  test("--no-hooks skips them on remove and prune", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace({
      executionLines: hookLines({ preRemove: [logRun] }),
    });
    const { context } = captureStderr();
    await createTaskWorktree(workspaceRoot, "a", { repos: ["foods"] }, context);
    await createTaskWorktree(workspaceRoot, "b", { repos: ["foods"] }, context);

    expect((await removeTaskWorktree(workspaceRoot, "a", { hooks: false }, context)).status).toBe(
      "ok",
    );
    expect((await pruneTaskWorktrees(workspaceRoot, { hooks: false }, context)).removed).toEqual([
      "b",
    ]);
    expect(await readHookLog(workspaceRoot)).toEqual([]);
  });
});
