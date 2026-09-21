import path from "node:path";
import { Command } from "commander";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { registerWorktreeCommand } from "../../src/cli/program/commands/register-worktree-command.js";
import { createCommandContextFixture } from "../utils/test-doubles.js";
import type { CommandContext } from "../../src/cli/program/commands/command-types.js";
import type { HumanReportKind } from "../../src/cli/output/human-renderer.js";
import type { OutputOptionValues } from "../../src/cli/program/shared-options.js";

const { createTaskWorktree, listTaskWorktrees, removeTaskWorktree, runReportAction } = vi.hoisted(
  () => ({
    createTaskWorktree: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    listTaskWorktrees: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
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
  }),
);

vi.mock("../../src/core/commands/execution.js", () => ({
  createTaskWorktree,
  listTaskWorktrees,
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
    const program = buildProgram(createCommandContextFixture());

    await program.parseAsync(["worktree", "list", "--workspace", "./ws"], { from: "user" });

    expect(listTaskWorktrees).toHaveBeenCalledWith(path.resolve(process.cwd(), "./ws"));
    expect(runReportAction.mock.calls[0]?.[1]).toBe("worktree-list");
  });
});
