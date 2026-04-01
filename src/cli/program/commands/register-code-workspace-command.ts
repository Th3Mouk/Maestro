import type { Command } from "commander";
import { projectEditorWorkspace } from "../../../core/execution-service.js";
import { addWorkspaceAndDryRunOptions, resolveWorkspacePath } from "../shared-options.js";

export function registerCodeWorkspaceCommand(program: Command): void {
  addWorkspaceAndDryRunOptions(
    program
      .command("code-workspace")
      .summary("Generate the optional VS Code multi-root workspace file")
      .description("Generate the optional multi-root editor workspace file"),
    "preview without writing",
  )
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  maestro code-workspace --workspace .",
        "  maestro code-workspace --workspace ./examples/ops-workspace",
      ].join("\n"),
    )
    .action(async (options: { workspace: string; dryRun?: boolean }) => {
      await projectEditorWorkspace(resolveWorkspacePath(options.workspace), options.dryRun);
    });
}
