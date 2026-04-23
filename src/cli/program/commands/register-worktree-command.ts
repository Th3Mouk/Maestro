import type { Command } from "commander";
import {
  createTaskWorktree,
  listTaskWorktrees,
  removeTaskWorktree,
} from "../../../core/commands/execution.js";
import {
  addOutputOptions,
  addWorkspaceAndDryRunOptions,
  addWorkspaceOption,
  resolveWorkspacePath,
  type OutputOptionValues,
} from "../shared-options.js";
import type { CommandContext } from "./command-types.js";
import { runReportAction } from "./command-helpers.js";

export function registerWorktreeCommand(program: Command, commandContext: CommandContext): void {
  const worktree = program
    .command("worktree")
    .summary("Create, list, and remove isolated task worktrees")
    .description("Manage isolated task worktrees spanning the workspace and managed repositories")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  maestro worktree create --task release-prep",
        "  maestro worktree list --workspace .",
        "  maestro worktree remove --task release-prep",
      ].join("\n"),
    );

  addOutputOptions(
    addWorkspaceAndDryRunOptions(
      worktree
        .command("create")
        .summary("Create an isolated task worktree across the managed repositories")
        .description(
          "Create an isolated task worktree for the workspace and its managed repositories",
        )
        .requiredOption("--task <name>", "task or worktree name"),
      "preview without writing",
    ),
  ).action(
    async (options: OutputOptionValues & { workspace: string; task: string; dryRun?: boolean }) => {
      await runReportAction(options, () =>
        createTaskWorktree(
          resolveWorkspacePath(options.workspace),
          options.task,
          { dryRun: options.dryRun },
          commandContext,
        ),
      );
    },
  );

  addOutputOptions(
    addWorkspaceAndDryRunOptions(
      worktree
        .command("remove")
        .summary("Remove an isolated task worktree across the managed repositories")
        .description(
          "Remove the task worktree for the workspace and its managed repositories. Committed work remains on the task branches; uncommitted work is preserved unless --force is passed.",
        )
        .requiredOption("--task <name>", "task or worktree name")
        .option(
          "--force",
          "force removal even if worktrees have uncommitted changes (discards them)",
          false,
        ),
      "preview without writing",
    ),
  ).action(
    async (
      options: OutputOptionValues & {
        workspace: string;
        task: string;
        force?: boolean;
        dryRun?: boolean;
      },
    ) => {
      await runReportAction(options, () =>
        removeTaskWorktree(
          resolveWorkspacePath(options.workspace),
          options.task,
          { force: options.force, dryRun: options.dryRun },
          commandContext,
        ),
      );
    },
  );

  addOutputOptions(
    addWorkspaceOption(
      worktree
        .command("list")
        .summary("List existing task worktrees for this workspace")
        .description("Enumerate task worktrees with their creation time and root path"),
    ),
  ).action(async (options: OutputOptionValues & { workspace: string }) => {
    await runReportAction(options, () =>
      listTaskWorktrees(resolveWorkspacePath(options.workspace)),
    );
  });
}
