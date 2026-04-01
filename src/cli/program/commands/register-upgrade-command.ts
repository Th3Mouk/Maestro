import type { Command } from "commander";
import { runUpgrade } from "../../upgrade.js";

export function registerUpgradeCommand(program: Command): void {
  program
    .command("upgrade")
    .summary("Upgrade the installed Maestro CLI")
    .description("Upgrade the installed Maestro CLI using the detected install manager")
    .addHelpText("after", ["", "Examples:", "  maestro upgrade"].join("\n"))
    .action(async () => {
      await runUpgrade();
    });
}
