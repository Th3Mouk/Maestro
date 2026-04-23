#!/usr/bin/env node
import { Command } from "commander";
import { pathToFileURL } from "node:url";
import { createCommandContext } from "../core/command-context.js";
import { formatUpgradeInstructions } from "./upgrade.js";
import { formatUnhandledCliError, isVerboseErrorMode } from "./program/error-output.js";
import { registerProgramCommands } from "./program/register-commands.js";
import { getFrameworkVersion } from "../version.js";

const CLI_CATCHLINE = "Multi-repository workspaces for engineering teams";
export { formatUnhandledCliError, isVerboseErrorMode } from "./program/error-output.js";

export function createProgram(): Command {
  const program = new Command();
  const frameworkVersion = getFrameworkVersion();
  const helpDescription = [
    CLI_CATCHLINE,
    "",
    `Current version: ${frameworkVersion}`,
    "",
    formatUpgradeInstructions(),
  ].join("\n");

  program.name("maestro").description(helpDescription).version(frameworkVersion);
  program.configureHelp({ sortSubcommands: false });
  program.showHelpAfterError("Use --help to inspect available commands.");
  program.showSuggestionAfterError();
  program.addHelpText(
    "afterAll",
    [
      "",
      "Quick start:",
      "  1. maestro init my-workspace",
      "  2. cd my-workspace",
      "  3. maestro workspace install --workspace . --dry-run",
      "  4. maestro workspace install --workspace .",
      "  5. maestro repo bootstrap --workspace .",
      "  6. maestro workspace doctor --workspace .",
      "",
      "Workspace model:",
      "  - maestro workspace install initializes the workspace Git repository when needed, then clones managed repositories and projects runtime artifacts.",
      "  - maestro repo bootstrap runs dependency bootstrap inside installed repositories from explicit commands or auto-detected manifests and lockfiles.",
      "  - maestro editor-workspace generates the optional VS Code multi-root file.",
      "  - managed repositories live under repos/<name>.",
      "",
      "Output model:",
      "  - workspace, repo, worktree, and editor-workspace commands print JSON reports to stdout.",
      "",
      "Need install options? See docs/cli/install.md in this repository.",
    ].join("\n"),
  );

  registerProgramCommands(program, createCommandContext());

  return program;
}

const isEntrypoint =
  process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isEntrypoint) {
  createProgram()
    .parseAsync(process.argv)
    .catch((error: unknown) => {
      process.stderr.write(formatUnhandledCliError(error, { showStack: isVerboseErrorMode() }));
      process.exitCode = 1;
    });
}
