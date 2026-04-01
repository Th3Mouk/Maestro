import type { Command } from "commander";
import { initWorkspace } from "../../../core/commands/workspace-init.js";
import { resolveWorkspacePath } from "../shared-options.js";
import { parseRuntimeNames } from "./command-helpers.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .summary("Scaffold a workspace from the default manifest template")
    .description(
      "Scaffold a partial or complete multi-repository workspace from the default manifest template",
    )
    .argument("[directory]", "target directory", ".")
    .option("--dry-run", "preview without writing", false)
    .option("--runtimes <list>", "comma-separated list of supported runtimes", "codex,claude-code")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  maestro init my-workspace",
        "  maestro init my-workspace --runtimes codex",
        "  maestro init .local/workspaces/my-codex-lab",
        "  maestro init my-workspace --dry-run",
      ].join("\n"),
    )
    .action(async (directory: string, options: { dryRun?: boolean; runtimes?: string }) => {
      await initWorkspace(resolveWorkspacePath(directory), {
        dryRun: options.dryRun,
        runtimeNames: parseRuntimeNames(options.runtimes),
      });
    });
}
