import type { Command } from "commander";
import { doctorWorkspace } from "../../../core/commands/workspace-doctor.js";
import { addWorkspaceOption, resolveWorkspacePath } from "../shared-options.js";
import type { CommandContext } from "./command-types.js";
import { writeJsonStdout } from "./command-helpers.js";

export function registerDoctorCommand(program: Command, commandContext: CommandContext): void {
  addWorkspaceOption(
    program
      .command("doctor")
      .summary("Validate workspace contract, repositories, and generated artifacts")
      .description(
        "Validate the workspace contract, managed repositories, and generated artifacts",
      ),
  )
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  maestro doctor",
        "  maestro doctor --workspace ./examples/ops-workspace",
      ].join("\n"),
    )
    .action(async (options: { workspace: string }) => {
      const report = await doctorWorkspace(resolveWorkspacePath(options.workspace), commandContext);
      await writeJsonStdout(report);
      process.exitCode = report.status === "error" ? 1 : 0;
    });
}
