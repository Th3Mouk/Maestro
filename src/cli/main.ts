#!/usr/bin/env node
import { Command } from "commander";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { RuntimeName } from "../runtime/types.js";
import { createCommandContext } from "../core/command-context.js";
import {
  checkoutWorkspaceGitBranches,
  pullWorkspaceGitBranches,
  syncWorkspaceGitBranches,
} from "../core/commands/workspace-git.js";
import { bootstrapWorkspace, createTaskWorktree } from "../core/commands/execution.js";
import { initWorkspace } from "../core/commands/workspace-init.js";
import { doctorWorkspace } from "../core/commands/workspace-doctor.js";
import {
  installWorkspace,
  syncWorkspace,
  updateWorkspace,
} from "../core/commands/workspace-install.js";
import { projectEditorWorkspace } from "../core/execution-service.js";
import { getFrameworkVersion } from "../version.js";

const VERBOSE_ERROR_ENV_KEYS = ["MAESTRO_VERBOSE", "MAESTRO_VERBOSE_ERRORS"] as const;
const VERBOSE_ERROR_ENV_TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export function isVerboseErrorMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return VERBOSE_ERROR_ENV_KEYS.some((key) => {
    const value = env[key];
    return (
      typeof value === "string" && VERBOSE_ERROR_ENV_TRUE_VALUES.has(value.trim().toLowerCase())
    );
  });
}

export function formatUnhandledCliError(
  error: unknown,
  options: { showStack?: boolean } = {},
): string {
  if (error instanceof Error) {
    if (options.showStack && error.stack) {
      return `${error.stack}\n`;
    }

    return `${error.message}\n`;
  }

  return `${String(error)}\n`;
}

export function createProgram(): Command {
  const program = new Command();
  const commandContext = createCommandContext();

  program
    .name("maestro")
    .description("Maestro: partial or complete multi-repository workspaces")
    .version(getFrameworkVersion());
  program.configureHelp({ sortSubcommands: false });
  program.showHelpAfterError();
  program.showSuggestionAfterError();
  program.addHelpText(
    "after",
    [
      "",
      "Getting started:",
      "  maestro init my-workspace",
      "  cd my-workspace",
      "  maestro install --workspace . --dry-run",
      "  maestro install --workspace .",
      "  maestro bootstrap --workspace .",
      "  maestro doctor --workspace .",
      "",
      "Workspace model:",
      "  - maestro install initializes the workspace Git repository when needed, then clones managed repositories and projects runtime artifacts.",
      "  - maestro bootstrap runs dependency preparation inside installed repositories.",
      "  - maestro code-workspace generates the optional VS Code multi-root file.",
      "  - managed repositories live under repos/<name>.",
      "",
      "Need install options? See docs/cli/install.md in this repository.",
    ].join("\n"),
  );

  program
    .command("init")
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
      await initWorkspace(path.resolve(process.cwd(), directory), {
        dryRun: options.dryRun,
        runtimeNames: parseRuntimeNames(options.runtimes),
      });
    });

  program
    .command("install")
    .description(
      "Initialize the workspace Git repository, materialize managed repositories, and generate workspace artifacts",
    )
    .option("--workspace <path>", "workspace root", ".")
    .option("--dry-run", "preview without writing", false)
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  maestro install --workspace . --dry-run",
        "  maestro install --workspace ./examples/ops-workspace",
      ].join("\n"),
    )
    .action(async (options: { workspace: string; dryRun?: boolean }) => {
      const report = await installWorkspace(
        path.resolve(process.cwd(), options.workspace),
        { dryRun: options.dryRun },
        commandContext,
      );
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    });

  program
    .command("bootstrap")
    .description("Detect managed repository toolchains and prepare dependencies")
    .option("--workspace <path>", "workspace root", ".")
    .option("--repository <name>", "repository to bootstrap")
    .option("--dry-run", "preview without executing", false)
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
      const report = await bootstrapWorkspace(path.resolve(process.cwd(), options.workspace), {
        dryRun: options.dryRun,
        repository: options.repository,
      });
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = report.status === "error" ? 1 : 0;
    });

  program
    .command("sync")
    .description("Reconcile the materialized workspace with the workspace manifest")
    .option("--workspace <path>", "workspace root", ".")
    .option("--dry-run", "preview without writing", false)
    .action(async (options: { workspace: string; dryRun?: boolean }) => {
      const report = await syncWorkspace(
        path.resolve(process.cwd(), options.workspace),
        { dryRun: options.dryRun },
        commandContext,
      );
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    });

  program
    .command("update")
    .description("Rerun resolution and regenerate workspace projections")
    .option("--workspace <path>", "workspace root", ".")
    .option("--dry-run", "preview without writing", false)
    .action(async (options: { workspace: string; dryRun?: boolean }) => {
      const report = await updateWorkspace(
        path.resolve(process.cwd(), options.workspace),
        { dryRun: options.dryRun },
        commandContext,
      );
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    });

  program
    .command("code-workspace")
    .description("Generate the optional multi-root editor workspace file")
    .option("--workspace <path>", "workspace root", ".")
    .option("--dry-run", "preview without writing", false)
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
      await projectEditorWorkspace(path.resolve(process.cwd(), options.workspace), options.dryRun);
    });

  program
    .command("worktree")
    .description("Create an isolated task worktree for the workspace and its managed repositories")
    .requiredOption("--task <name>", "task or worktree name")
    .option("--workspace <path>", "workspace root", ".")
    .option("--dry-run", "preview without writing", false)
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  maestro worktree --task release-prep",
        "  maestro worktree --workspace ./examples/ops-workspace --task release-prep",
        "  maestro worktree --task release-prep --dry-run",
      ].join("\n"),
    )
    .action(async (options: { workspace: string; task: string; dryRun?: boolean }) => {
      const report = await createTaskWorktree(
        path.resolve(process.cwd(), options.workspace),
        options.task,
        { dryRun: options.dryRun },
        commandContext,
      );
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = report.status === "error" ? 1 : 0;
    });

  program
    .command("doctor")
    .description("Validate the workspace contract, managed repositories, and generated artifacts")
    .option("--workspace <path>", "workspace root", ".")
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
      const report = await doctorWorkspace(
        path.resolve(process.cwd(), options.workspace),
        commandContext,
      );
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = report.status === "error" ? 1 : 0;
    });

  const git = program
    .command("git")
    .description("Run bulk Git operations across managed repositories in the workspace");

  git
    .command("checkout")
    .description("Check out each managed repository onto its reference branch")
    .option("--workspace <path>", "workspace root", ".")
    .action(async (options: { workspace: string }) => {
      const report = await checkoutWorkspaceGitBranches(
        path.resolve(process.cwd(), options.workspace),
        commandContext,
      );
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = report.status === "ok" ? 0 : 1;
    });

  git
    .command("pull")
    .description("Pull the currently checked out branch in each managed repository")
    .option("--workspace <path>", "workspace root", ".")
    .action(async (options: { workspace: string }) => {
      const report = await pullWorkspaceGitBranches(
        path.resolve(process.cwd(), options.workspace),
        commandContext,
      );
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = report.status === "ok" ? 0 : 1;
    });

  git
    .command("sync")
    .description("Check out reference branches, then pull each managed repository")
    .option("--workspace <path>", "workspace root", ".")
    .action(async (options: { workspace: string }) => {
      const report = await syncWorkspaceGitBranches(
        path.resolve(process.cwd(), options.workspace),
        commandContext,
      );
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
      process.exitCode = report.status === "ok" ? 0 : 1;
    });

  return program;
}

function parseRuntimeNames(value?: string): RuntimeName[] | undefined {
  if (!value) {
    return undefined;
  }

  const supportedRuntimeNames: RuntimeName[] = ["codex", "claude-code", "opencode"];
  const runtimes = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const invalidRuntimeNames = runtimes.filter(
    (runtime): runtime is string => !supportedRuntimeNames.includes(runtime as RuntimeName),
  );
  if (invalidRuntimeNames.length > 0) {
    throw new Error(
      `Unsupported runtime(s): ${invalidRuntimeNames.join(", ")}. Supported values: ${supportedRuntimeNames.join(", ")}`,
    );
  }

  return runtimes.length > 0 ? Array.from(new Set(runtimes as RuntimeName[])) : undefined;
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
