import type { Command } from "commander";
import path from "node:path";

export function addWorkspaceOption(command: Command): Command {
  return command.option("--workspace <path>", "workspace root", ".");
}

function addDryRunOption(command: Command, description: string): Command {
  return command.option("--dry-run", description, false);
}

export function addWorkspaceAndDryRunOptions(command: Command, dryRunDescription: string): Command {
  return addDryRunOption(addWorkspaceOption(command), dryRunDescription);
}

export function resolveWorkspacePath(workspacePath: string): string {
  return path.resolve(process.cwd(), workspacePath);
}
