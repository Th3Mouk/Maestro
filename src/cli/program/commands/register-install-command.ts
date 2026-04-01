import type { Command } from "commander";
import { installWorkspace } from "../../../core/commands/workspace-install.js";
import { addWorkspaceAndDryRunOptions, resolveWorkspacePath } from "../shared-options.js";
import type { CommandContext } from "./command-types.js";
import { writeJsonStdout } from "./command-helpers.js";

export function registerInstallCommand(program: Command, commandContext: CommandContext): void {
  addWorkspaceAndDryRunOptions(
    program
      .command("install")
      .summary("Initialize the workspace and materialize managed repositories")
      .description(
        "Initialize the workspace Git repository, materialize managed repositories, and generate workspace artifacts",
      ),
    "preview without writing",
  )
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  maestro install --workspace . --dry-run",
        "  maestro install --workspace ./examples/ops-workspace",
      ].join("\n"),
    )
    .action(async (options: { workspace: string; dryRun?: boolean }) => {
      const report = await installWorkspace(
        resolveWorkspacePath(options.workspace),
        { dryRun: options.dryRun },
        commandContext,
      );
      await writeJsonStdout(report);
    });
}
