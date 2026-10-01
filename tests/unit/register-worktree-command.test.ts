import path from "node:path";
import { Command } from "commander";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { registerWorktreeCommand } from "../../src/cli/program/commands/register-worktree-command.js";
import { createCommandContextFixture } from "../utils/test-doubles.js";
import type { CommandContext } from "../../src/cli/program/commands/command-types.js";
import type { HumanReportKind } from "../../src/cli/output/human-renderer.js";
import type { OutputOptionValues } from "../../src/cli/program/shared-options.js";

const {
  createTaskWorktree,
  listTaskWorktrees,
  pruneTaskWorktrees,
  removeTaskWorktree,
  runReportAction,
} = vi.hoisted(() => ({
  createTaskWorktree: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
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
      { dryRun: true },
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
      { dryRun: false, repos: ["foods", "platform-api"] },
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
      { force: true, dryRun: false },
      commandContext,
    );
    expect(runReportAction.mock.calls[0]?.[1]).toBe("worktree-remove");
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
      { branches: true, dryRun: true, fetch: false, includeGone: true },
      commandContext,
    );
    expect(runReportAction.mock.calls[0]?.[1]).toBe("worktree-prune");
  });

  test("prune fetches by default", async () => {
    const program = buildProgram(createCommandContextFixture());

    await program.parseAsync(["worktree", "prune", "--workspace", "./ws"], { from: "user" });

    expect(pruneTaskWorktrees.mock.calls[0]?.[1]).toMatchObject({ fetch: true, dryRun: false });
  });
});
