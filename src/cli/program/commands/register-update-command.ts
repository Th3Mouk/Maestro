import type { Command } from "commander";
import { updateWorkspace } from "../../../core/commands/workspace-install.js";
import { addWorkspaceAndDryRunOptions, resolveWorkspacePath } from "../shared-options.js";
import type { CommandContext } from "./command-types.js";
import { writeJsonStdout } from "./command-helpers.js";

export function registerUpdateCommand(program: Command, commandContext: CommandContext): void {
  addWorkspaceAndDryRunOptions(
    program
      .command("update")
      .summary("Regenerate workspace projections from the current manifest")
      .description("Rerun resolution and regenerate workspace projections"),
    "preview without writing",
  ).action(async (options: { workspace: string; dryRun?: boolean }) => {
    const report = await updateWorkspace(
      resolveWorkspacePath(options.workspace),
      { dryRun: options.dryRun },
      commandContext,
    );
    await writeJsonStdout(report);
    process.exitCode = report.status === "error" ? 1 : 0;
  });
}
