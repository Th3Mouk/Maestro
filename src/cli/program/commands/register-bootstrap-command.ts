import type { Command } from "commander";
import { bootstrapWorkspace } from "../../../core/commands/execution.js";
import { addWorkspaceAndDryRunOptions, resolveWorkspacePath } from "../shared-options.js";
import { writeJsonStdout } from "./command-helpers.js";

export function registerBootstrapCommand(program: Command): void {
  addWorkspaceAndDryRunOptions(
    program
      .command("bootstrap")
      .summary("Detect toolchains and prepare dependencies in managed repositories")
      .description("Detect managed repository toolchains and prepare dependencies")
      .option("--repository <name>", "repository to bootstrap"),
    "preview without executing",
  )
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  maestro bootstrap --workspace .",
        "  maestro bootstrap --workspace . --repository foodpilot-api",
        "  maestro bootstrap --workspace ./examples/ops-workspace --dry-run",
        "",
        "Use after `maestro install` has materialized repositories.",
        "Auto mode detects composer, uv, npm, pnpm, yarn, and bun from each repository.",
      ].join("\n"),
    )
    .action(async (options: { workspace: string; repository?: string; dryRun?: boolean }) => {
      const report = await bootstrapWorkspace(resolveWorkspacePath(options.workspace), {
        dryRun: options.dryRun,
        repository: options.repository,
      });
      await writeJsonStdout(report);
      process.exitCode = report.status === "error" ? 1 : 0;
    });
}
