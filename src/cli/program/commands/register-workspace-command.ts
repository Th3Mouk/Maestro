import type { Command } from "commander";
import {
  installWorkspace,
  syncWorkspace,
  updateWorkspace,
} from "../../../core/commands/workspace-install.js";
import { doctorWorkspace } from "../../../core/commands/workspace-doctor.js";
import {
  addOutputOptions,
  addWorkspaceAndDryRunOptions,
  addWorkspaceOption,
  resolveWorkspacePath,
  type OutputOptionValues,
} from "../shared-options.js";
import type { CommandContext } from "./command-types.js";
import { runReportAction } from "./command-helpers.js";

type WorkspaceLifecycleOptions = OutputOptionValues & {
  workspace: string;
  dryRun?: boolean;
};

type WorkspaceDoctorOptions = OutputOptionValues & { workspace: string };

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

  addOutputOptions(
    addWorkspaceAndDryRunOptions(
      workspace
        .command("install")
        .summary("Initialize the workspace and materialize managed repositories")
        .description(
          "Initialize the workspace Git repository, materialize managed repositories, and generate workspace artifacts",
        ),
      "preview without writing",
    ),
  ).action(async (options: WorkspaceLifecycleOptions) => {
    await runReportAction(options, () =>
      installWorkspace(
        resolveWorkspacePath(options.workspace),
        { dryRun: options.dryRun },
        commandContext,
      ),
    );
  });

  addOutputOptions(
    addWorkspaceAndDryRunOptions(
      workspace
        .command("update")
        .summary("Regenerate workspace projections from the current manifest")
        .description("Rerun resolution and regenerate workspace projections"),
      "preview without writing",
    ),
  ).action(async (options: WorkspaceLifecycleOptions) => {
    await runReportAction(options, () =>
      updateWorkspace(
        resolveWorkspacePath(options.workspace),
        { dryRun: options.dryRun },
        commandContext,
      ),
    );
  });

  addOutputOptions(
    addWorkspaceAndDryRunOptions(
      workspace
        .command("prune")
        .summary("Remove managed repositories that were deleted from the manifest")
        .description(
          "Reconcile the materialized workspace with the manifest by removing stale repositories and rerunning install",
        ),
      "preview without writing",
    ),
  ).action(async (options: WorkspaceLifecycleOptions) => {
    await runReportAction(options, () =>
      syncWorkspace(
        resolveWorkspacePath(options.workspace),
        { dryRun: options.dryRun },
        commandContext,
      ),
    );
  });

  addOutputOptions(
    addWorkspaceOption(
      workspace
        .command("doctor")
        .summary("Validate workspace contract, repositories, and generated artifacts")
        .description(
          "Validate the workspace contract, managed repositories, and generated artifacts",
        ),
    ),
  ).action(async (options: WorkspaceDoctorOptions) => {
    await runReportAction(options, () =>
      doctorWorkspace(resolveWorkspacePath(options.workspace), commandContext),
    );
  });
}
