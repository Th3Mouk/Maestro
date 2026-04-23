import type { Command } from "commander";
import {
  installWorkspace,
  syncWorkspace,
  updateWorkspace,
} from "../../../core/commands/workspace-install.js";
import { doctorWorkspace } from "../../../core/commands/workspace-doctor.js";
import {
  addWorkspaceAndDryRunOptions,
  addWorkspaceOption,
  resolveWorkspacePath,
} from "../shared-options.js";
import type { CommandContext } from "./command-types.js";
import { writeJsonStdout } from "./command-helpers.js";

export function registerWorkspaceCommand(program: Command, commandContext: CommandContext): void {
  const workspace = program
    .command("workspace")
    .summary("Manage the workspace lifecycle (install, update, prune, doctor)")
    .description("Commands that operate on the workspace as a whole")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  maestro workspace install --workspace .",
        "  maestro workspace update --workspace .",
        "  maestro workspace prune --workspace .",
        "  maestro workspace doctor --workspace .",
      ].join("\n"),
    );

  addWorkspaceAndDryRunOptions(
    workspace
      .command("install")
      .summary("Initialize the workspace and materialize managed repositories")
      .description(
        "Initialize the workspace Git repository, materialize managed repositories, and generate workspace artifacts",
      ),
    "preview without writing",
  ).action(async (options: { workspace: string; dryRun?: boolean }) => {
    const report = await installWorkspace(
      resolveWorkspacePath(options.workspace),
      { dryRun: options.dryRun },
      commandContext,
    );
    await writeJsonStdout(report);
    process.exitCode = report.status === "error" ? 1 : 0;
  });

  addWorkspaceAndDryRunOptions(
    workspace
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

  addWorkspaceAndDryRunOptions(
    workspace
      .command("prune")
      .summary("Remove managed repositories that were deleted from the manifest")
      .description(
        "Reconcile the materialized workspace with the manifest by removing stale repositories and rerunning install",
      ),
    "preview without writing",
  ).action(async (options: { workspace: string; dryRun?: boolean }) => {
    const report = await syncWorkspace(
      resolveWorkspacePath(options.workspace),
      { dryRun: options.dryRun },
      commandContext,
    );
    await writeJsonStdout(report);
    process.exitCode = report.status === "error" ? 1 : 0;
  });

  addWorkspaceOption(
    workspace
      .command("doctor")
      .summary("Validate workspace contract, repositories, and generated artifacts")
      .description(
        "Validate the workspace contract, managed repositories, and generated artifacts",
      ),
  ).action(async (options: { workspace: string }) => {
    const report = await doctorWorkspace(resolveWorkspacePath(options.workspace), commandContext);
    await writeJsonStdout(report);
    process.exitCode = report.status === "error" ? 1 : 0;
  });
}
