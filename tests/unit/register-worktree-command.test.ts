import path from "node:path";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { registerWorktreeCommand } from "../../src/cli/program/commands/register-worktree-command.js";
import { createCommandContextFixture } from "../utils/test-doubles.js";
import type { CommandContext } from "../../src/cli/program/commands/command-types.js";
import type { HumanReportKind } from "../../src/cli/output/human-renderer.js";
import type { OutputOptionValues } from "../../src/cli/program/shared-options.js";

const {
  createTaskWorktree,
  getTaskWorktreePath,
  listTaskWorktrees,
  openTaskWorktree,
  pruneTaskWorktrees,
  removeTaskWorktree,
  runReportAction,
} = vi.hoisted(() => ({
  createTaskWorktree: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  getTaskWorktreePath: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  openTaskWorktree: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listTaskWorktrees: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  pruneTaskWorktrees: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  removeTaskWorktree: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  runReportAction: vi.fn<
    (
      options: OutputOptionValues,
      reportKind: HumanReportKind,
      run: () => Promise<unknown>,
    ) => Promise<void>
  >(async (_options, _reportKind, run) => {
    await run();
  }),
}));

vi.mock("../../src/core/commands/execution.js", () => ({
  createTaskWorktree,
  getTaskWorktreePath,
  openTaskWorktree,
  listTaskWorktrees,
  pruneTaskWorktrees,
  removeTaskWorktree,
}));

vi.mock("../../src/cli/program/commands/command-helpers.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/cli/program/commands/command-helpers.js")>();
  return { ...actual, runReportAction };
});

function buildProgram(commandContext: CommandContext): Command {
  const program = new Command();
  program.exitOverride();
  registerWorktreeCommand(program, commandContext);
  return program;
}

describe("registerWorktreeCommand", () => {
  beforeEach(() => {
    createTaskWorktree.mockResolvedValue({ status: "ok" });
    listTaskWorktrees.mockResolvedValue({ status: "ok" });
    removeTaskWorktree.mockResolvedValue({ status: "ok" });
  });

  test("create resolves the workspace path, forwards --task and dryRun, reporting as worktree-create", async () => {
    const commandContext = createCommandContextFixture();
    const program = buildProgram(commandContext);

    await program.parseAsync(
      ["worktree", "create", "--workspace", "./ws", "--task", "release-prep", "--dry-run"],
      { from: "user" },
    );

    expect(createTaskWorktree).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "./ws"),
      "release-prep",
      { dryRun: true, hooks: true },
      commandContext,
    );
    expect(runReportAction.mock.calls[0]?.[1]).toBe("worktree-create");
  });

  test("create forwards --repos as a list of repository names", async () => {
    const commandContext = createCommandContextFixture();
    const program = buildProgram(commandContext);

    await program.parseAsync(
      [
        "worktree",
        "create",
        "--workspace",
        "./ws",
        "--task",
        "t",
        "--repos",
        "foods, platform-api,",
      ],
      { from: "user" },
    );

    expect(createTaskWorktree).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "./ws"),
      "t",
      { dryRun: false, hooks: true, repos: ["foods", "platform-api"] },
      commandContext,
    );
  });

  test("create requires --task", async () => {
    const program = buildProgram(createCommandContextFixture());

    await expect(
      program.parseAsync(["worktree", "create", "--workspace", "./ws"], { from: "user" }),
    ).rejects.toThrow(/--task/);
    expect(createTaskWorktree).not.toHaveBeenCalled();
  });

  test("remove resolves the workspace path, forwards --task/--force/dryRun, reporting as worktree-remove", async () => {
    const commandContext = createCommandContextFixture();
    const program = buildProgram(commandContext);

    await program.parseAsync(
      ["worktree", "remove", "--workspace", "./ws", "--task", "release-prep", "--force"],
      { from: "user" },
    );

    expect(removeTaskWorktree).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "./ws"),
      "release-prep",
      { force: true, dryRun: false, hooks: true },
      commandContext,
    );
    expect(runReportAction.mock.calls[0]?.[1]).toBe("worktree-remove");
  });

  test("prune --task is repeatable", async () => {
    const commandContext = createCommandContextFixture();
    const program = buildProgram(commandContext);

    await program.parseAsync(
      ["worktree", "prune", "--workspace", "./ws", "--task", "a", "--task", "b"],
      { from: "user" },
    );

    expect(pruneTaskWorktrees).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "./ws"),
      expect.objectContaining({ tasks: ["a", "b"] }),
      commandContext,
    );
  });

  test("--forge is forwarded to list and prune, and rejects unknown forges", async () => {
    const commandContext = createCommandContextFixture();
    const program = buildProgram(commandContext);

    await program.parseAsync(
      ["worktree", "list", "--workspace", "./ws", "--status", "--forge", "github"],
      { from: "user" },
    );
    await program.parseAsync(["worktree", "prune", "--workspace", "./ws", "--forge", "none"], {
      from: "user",
    });

    expect(listTaskWorktrees).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "./ws"),
      { forge: "github", status: true },
      commandContext,
    );
    expect(pruneTaskWorktrees).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "./ws"),
      expect.objectContaining({ forge: "none" }),
      commandContext,
    );
    await expect(
      buildProgram(commandContext).parseAsync(
        ["worktree", "prune", "--workspace", "./ws", "--forge", "gitlab"],
        { from: "user" },
      ),
    ).rejects.toThrow(/Allowed choices/);
  });

  test("--no-hooks is forwarded as hooks: false", async () => {
    const commandContext = createCommandContextFixture();
    const program = buildProgram(commandContext);

    await program.parseAsync(
      ["worktree", "remove", "--workspace", "./ws", "--task", "release-prep", "--no-hooks"],
      { from: "user" },
    );

    expect(removeTaskWorktree).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "./ws"),
      "release-prep",
      { force: false, dryRun: false, hooks: false },
      commandContext,
    );
  });

  test("list resolves the workspace path and reports as worktree-list", async () => {
    const commandContext = createCommandContextFixture();
    const program = buildProgram(commandContext);

    await program.parseAsync(["worktree", "list", "--workspace", "./ws", "--status"], {
      from: "user",
    });

    expect(listTaskWorktrees).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "./ws"),
      { status: true },
      commandContext,
    );
    expect(runReportAction.mock.calls[0]?.[1]).toBe("worktree-list");
  });

  test("prune forwards its flags and reports as worktree-prune", async () => {
    const commandContext = createCommandContextFixture();
    const program = buildProgram(commandContext);

    await program.parseAsync(
      [
        "worktree",
        "prune",
        "--workspace",
        "./ws",
        "--dry-run",
        "--include-gone",
        "--branches",
        "--no-fetch",
      ],
      { from: "user" },
    );

    expect(pruneTaskWorktrees).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "./ws"),
      { branches: true, dryRun: true, fetch: false, hooks: true, includeGone: true },
      commandContext,
    );
    expect(runReportAction.mock.calls[0]?.[1]).toBe("worktree-prune");
  });

  test("prune fetches by default", async () => {
    const program = buildProgram(createCommandContextFixture());

    await program.parseAsync(["worktree", "prune", "--workspace", "./ws"], { from: "user" });

    expect(pruneTaskWorktrees.mock.calls[0]?.[1]).toMatchObject({ fetch: true, dryRun: false });
  });

  describe("path and open", () => {
    let stdout: string[];
    let stderr: string[];

    beforeEach(() => {
      stdout = [];
      stderr = [];
      vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
        stdout.push(String(chunk));
        return true;
      });
      vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
        stderr.push(String(chunk));
        return true;
      });
    });

    afterEach(() => {
      vi.restoreAllMocks();
      process.exitCode = undefined;
    });

    test("path prints only the root on stdout", async () => {
      getTaskWorktreePath.mockResolvedValue({
        status: "ok",
        workspace: "ws",
        name: "a",
        root: "/ws/worktrees/a",
        issues: [],
      });

      await buildProgram(createCommandContextFixture()).parseAsync(
        ["worktree", "path", "a", "--workspace", "./ws"],
        { from: "user" },
      );

      expect(stdout.join("")).toBe("/ws/worktrees/a\n");
      expect(stderr.join("")).toBe("");
      expect(process.exitCode).toBe(0);
    });

    test("a failing path writes the issue to stderr and nothing to stdout", async () => {
      getTaskWorktreePath.mockResolvedValue({
        status: "error",
        workspace: "ws",
        name: "",
        root: "",
        issues: [{ code: "TASK_REQUIRED", message: "Name the task." }],
      });

      await buildProgram(createCommandContextFixture()).parseAsync(
        ["worktree", "path", "--workspace", "./ws"],
        { from: "user" },
      );

      expect(stdout.join("")).toBe("");
      expect(stderr.join("")).toContain("TASK_REQUIRED");
      expect(process.exitCode).toBe(1);
    });

    test("open forwards --editor and --create, reports on stderr, and prints the root", async () => {
      const commandContext = createCommandContextFixture();
      openTaskWorktree.mockResolvedValue({
        status: "ok",
        workspace: "ws",
        name: "a",
        root: "/ws/worktrees/a",
        editor: "cursor",
        launch: "cursor /ws/worktrees/a/a.code-workspace",
        issues: [],
      });

      await buildProgram(commandContext).parseAsync(
        ["worktree", "open", "a", "--workspace", "./ws", "--editor", "cursor", "--create"],
        { from: "user" },
      );

      expect(openTaskWorktree).toHaveBeenCalledWith(
        path.resolve(process.cwd(), "./ws"),
        "a",
        expect.objectContaining({ create: true, editor: "cursor" }),
        commandContext,
      );
      expect(stdout.join("")).toBe("/ws/worktrees/a\n");
      expect(stderr.join("")).toContain("worktree open a: ok");
    });
  });
});
