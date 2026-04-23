import type { Command } from "commander";
import { projectEditorWorkspace } from "../../../core/execution-service.js";
import { addWorkspaceAndDryRunOptions, resolveWorkspacePath } from "../shared-options.js";

export function registerEditorWorkspaceCommand(program: Command): void {
  addWorkspaceAndDryRunOptions(
    program
      .command("editor-workspace")
      .summary("Generate the optional multi-root editor workspace file")
      .description("Generate the optional multi-root editor workspace file (e.g. VS Code)"),
    "preview without writing",
  )
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  maestro editor-workspace --workspace .",
        "  maestro editor-workspace --workspace ./examples/ops-workspace",
      ].join("\n"),
    )
    .action(async (options: { workspace: string; dryRun?: boolean }) => {
      await projectEditorWorkspace(resolveWorkspacePath(options.workspace), options.dryRun);
    });
}
