import type { Command } from "commander";
import { runUpgrade } from "../../upgrade.js";

export function registerSelfCommand(program: Command): void {
  const self = program
    .command("self")
    .summary("Manage the installed Maestro CLI")
    .description("Commands that operate on the Maestro CLI installation itself")
    .addHelpText("after", ["", "Examples:", "  maestro self upgrade"].join("\n"));

  self
    .command("upgrade")
    .summary("Upgrade the installed Maestro CLI")
    .description("Upgrade the installed Maestro CLI using the detected install manager")
    .action(async () => {
      await runUpgrade();
    });
}
