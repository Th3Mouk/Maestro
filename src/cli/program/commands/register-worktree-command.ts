import type { Command } from "commander";
import { createTaskWorktree } from "../../../core/commands/execution.js";
import { addWorkspaceAndDryRunOptions, resolveWorkspacePath } from "../shared-options.js";
import type { CommandContext } from "./command-types.js";
import { writeJsonStdout } from "./command-helpers.js";

export function registerWorktreeCommand(program: Command, commandContext: CommandContext): void {
  addWorkspaceAndDryRunOptions(
    program
      .command("worktree")
      .summary("Create an isolated task worktree across the managed repositories")
      .description(
        "Create an isolated task worktree for the workspace and its managed repositories",
      )
      .requiredOption("--task <name>", "task or worktree name"),
    "preview without writing",
  )
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  maestro worktree --task release-prep",
        "  maestro worktree --workspace ./examples/ops-workspace --task release-prep",
        "  maestro worktree --task release-prep --dry-run",
      ].join("\n"),
    )
    .action(async (options: { workspace: string; task: string; dryRun?: boolean }) => {
      const report = await createTaskWorktree(
        resolveWorkspacePath(options.workspace),
        options.task,
        {
          dryRun: options.dryRun,
        },
        commandContext,
      );
      await writeJsonStdout(report);
      process.exitCode = report.status === "error" ? 1 : 0;
    });
}
