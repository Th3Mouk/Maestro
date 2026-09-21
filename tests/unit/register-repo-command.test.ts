import path from "node:path";
import { Command } from "commander";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { registerRepoCommand } from "../../src/cli/program/commands/register-repo-command.js";
import { createCommandContextFixture } from "../utils/test-doubles.js";
import type { CommandContext } from "../../src/cli/program/commands/command-types.js";
import type { HumanReportKind } from "../../src/cli/output/human-renderer.js";
import type { OutputOptionValues } from "../../src/cli/program/shared-options.js";

const {
  bootstrapWorkspace,
  listWorkspaceRepositories,
  checkoutWorkspaceGitBranches,
  pullWorkspaceGitBranches,
  syncWorkspaceGitBranches,
  runReportAction,
} = vi.hoisted(() => ({
  bootstrapWorkspace: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listWorkspaceRepositories: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  checkoutWorkspaceGitBranches: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  pullWorkspaceGitBranches: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  syncWorkspaceGitBranches: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
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
  bootstrapWorkspace,
  listWorkspaceRepositories,
}));

vi.mock("../../src/core/commands/workspace-git.js", () => ({
  checkoutWorkspaceGitBranches,
  pullWorkspaceGitBranches,
  syncWorkspaceGitBranches,
}));

vi.mock("../../src/cli/program/commands/command-helpers.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/cli/program/commands/command-helpers.js")>();
  return { ...actual, runReportAction };
});

function buildProgram(commandContext: CommandContext): Command {
  const program = new Command();
  program.exitOverride();
  registerRepoCommand(program, commandContext);
  return program;
}

describe("registerRepoCommand", () => {
  beforeEach(() => {
    bootstrapWorkspace.mockResolvedValue({ status: "ok" });
    listWorkspaceRepositories.mockResolvedValue({ status: "ok" });
    checkoutWorkspaceGitBranches.mockResolvedValue({ status: "ok" });
    pullWorkspaceGitBranches.mockResolvedValue({ status: "ok" });
    syncWorkspaceGitBranches.mockResolvedValue({ status: "ok" });
  });

  test("bootstrap resolves the workspace path and forwards dryRun/repository, reporting as bootstrap", async () => {
    const commandContext = createCommandContextFixture();
    const program = buildProgram(commandContext);

    await program.parseAsync(
      ["repo", "bootstrap", "--workspace", "./ws", "--dry-run", "--repository", "api"],
      { from: "user" },
    );

    expect(bootstrapWorkspace).toHaveBeenCalledWith(path.resolve(process.cwd(), "./ws"), {
      dryRun: true,
      repository: "api",
    });
    expect(runReportAction.mock.calls[0]?.[1]).toBe("bootstrap");
  });

  test("bootstrap without --repository leaves it undefined", async () => {
    const program = buildProgram(createCommandContextFixture());

    await program.parseAsync(["repo", "bootstrap", "--workspace", "./ws"], { from: "user" });

    expect(bootstrapWorkspace).toHaveBeenCalledWith(path.resolve(process.cwd(), "./ws"), {
      dryRun: false,
      repository: undefined,
    });
  });

  test("list resolves the workspace path and reports as repo-list", async () => {
    const program = buildProgram(createCommandContextFixture());

    await program.parseAsync(["repo", "list", "--workspace", "./ws"], { from: "user" });

    expect(listWorkspaceRepositories).toHaveBeenCalledWith(path.resolve(process.cwd(), "./ws"));
    expect(runReportAction.mock.calls[0]?.[1]).toBe("repo-list");
  });

  test("git checkout resolves the workspace path, passes the command context, and reports as workspace-git", async () => {
    const commandContext = createCommandContextFixture();
    const program = buildProgram(commandContext);

    await program.parseAsync(["repo", "git", "checkout", "--workspace", "./ws"], {
      from: "user",
    });

    expect(checkoutWorkspaceGitBranches).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "./ws"),
      commandContext,
    );
    expect(runReportAction.mock.calls[0]?.[1]).toBe("workspace-git");
  });

  test("git pull resolves the workspace path and passes the command context", async () => {
    const commandContext = createCommandContextFixture();
    const program = buildProgram(commandContext);

    await program.parseAsync(["repo", "git", "pull", "--workspace", "./ws"], { from: "user" });

    expect(pullWorkspaceGitBranches).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "./ws"),
      commandContext,
    );
  });

  test("git sync resolves the workspace path and passes the command context", async () => {
    const commandContext = createCommandContextFixture();
    const program = buildProgram(commandContext);

    await program.parseAsync(["repo", "git", "sync", "--workspace", "./ws"], { from: "user" });

    expect(syncWorkspaceGitBranches).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "./ws"),
      commandContext,
    );
  });
});
