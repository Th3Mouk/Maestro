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

/**
 * Registers the output-format options on a report-emitting command.
 *
 * - `--format <format>`: explicit format selector ("human" or "json"). Validation
 *   happens in {@link resolveFormat} so unknown values surface a clear error.
 * - `--json`: boolean shorthand that forces JSON output regardless of TTY.
 * - `--no-color`: registered for Phase 4b; accepted but currently ignored.
 *
 * Commander defaults are intentionally omitted so that precedence with the
 * MAESTRO_FORMAT env var and TTY auto-detection remains meaningful.
 */
export function addOutputOptions(command: Command): Command {
  return command
    .option("--format <format>", "output format: human|json")
    .option("--json", "emit JSON output (shorthand for --format json)")
    .option("--no-color", "disable ANSI colors in human output");
}

export interface OutputOptionValues {
  format?: string;
  json?: boolean;
  color?: boolean;
}
