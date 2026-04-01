import type { Command } from "commander";
import { syncWorkspace } from "../../../core/commands/workspace-install.js";
import { addWorkspaceAndDryRunOptions, resolveWorkspacePath } from "../shared-options.js";
import type { CommandContext } from "./command-types.js";
import { writeJsonStdout } from "./command-helpers.js";

export function registerSyncCommand(program: Command, commandContext: CommandContext): void {
  addWorkspaceAndDryRunOptions(
    program
      .command("sync")
      .summary("Reconcile the materialized workspace with the manifest")
      .description("Reconcile the materialized workspace with the workspace manifest"),
    "preview without writing",
  ).action(async (options: { workspace: string; dryRun?: boolean }) => {
    const report = await syncWorkspace(
      resolveWorkspacePath(options.workspace),
      { dryRun: options.dryRun },
      commandContext,
    );
    await writeJsonStdout(report);
  });
}
