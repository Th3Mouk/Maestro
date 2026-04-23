import type { Command } from "commander";
import { bootstrapWorkspace, listWorkspaceRepositories } from "../../../core/commands/execution.js";
import {
  checkoutWorkspaceGitBranches,
  pullWorkspaceGitBranches,
  syncWorkspaceGitBranches,
} from "../../../core/commands/workspace-git.js";
import type { ReportStatus } from "../../../report/types.js";
import {
  addOutputOptions,
  addWorkspaceAndDryRunOptions,
  addWorkspaceOption,
  resolveWorkspacePath,
  type OutputOptionValues,
} from "../shared-options.js";
import type { CommandContext } from "./command-types.js";
import { runReportAction } from "./command-helpers.js";

type GitCommandReport = { status: ReportStatus };

type GitSubcommandRunner = (
  workspacePath: string,
  commandContext: CommandContext,
) => Promise<GitCommandReport>;

function registerGitSubcommand(
  git: Command,
  commandContext: CommandContext,
  options: { name: string; summary: string; description: string; run: GitSubcommandRunner },
): void {
  addOutputOptions(
    addWorkspaceOption(
      git.command(options.name).summary(options.summary).description(options.description),
    ),
  ).action(async (commandOptions: OutputOptionValues & { workspace: string }) => {
    await runReportAction(commandOptions, "workspace-git", () =>
      options.run(resolveWorkspacePath(commandOptions.workspace), commandContext),
    );
  });
}

export function registerRepoCommand(program: Command, commandContext: CommandContext): void {
  const repo = program
    .command("repo")
    .summary("Inspect and operate on managed repositories")
    .description("Commands that operate across the managed repositories in the workspace")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  maestro repo list --workspace .",
        "  maestro repo bootstrap --workspace .",
        "  maestro repo git sync --workspace .",
      ].join("\n"),
    );

  addOutputOptions(
    addWorkspaceAndDryRunOptions(
      repo
        .command("bootstrap")
        .summary("Detect install strategy and run dependency bootstrap per repository")
        .description(
          "Run repository dependency bootstrap from explicit commands or auto-detected manifests and lockfiles",
        )
        .option("--repository <name>", "repository to bootstrap"),
      "preview without executing",
    ),
  ).action(
    async (
      options: OutputOptionValues & {
        workspace: string;
        repository?: string;
        dryRun?: boolean;
      },
    ) => {
      await runReportAction(options, "bootstrap", () =>
        bootstrapWorkspace(resolveWorkspacePath(options.workspace), {
          dryRun: options.dryRun,
          repository: options.repository,
        }),
      );
    },
  );

  addOutputOptions(
    addWorkspaceOption(
      repo
        .command("list")
        .summary("List managed repositories declared in the workspace manifest")
        .description(
          "List repositories declared in the workspace manifest with branch, remote, and install status",
        ),
    ),
  ).action(async (options: OutputOptionValues & { workspace: string }) => {
    await runReportAction(options, "repo-list", () =>
      listWorkspaceRepositories(resolveWorkspacePath(options.workspace)),
    );
  });

  const git = repo
    .command("git")
    .summary("Run workspace-scoped Git operations across managed repositories")
    .description("Run bulk Git operations across managed repositories in the workspace");

  registerGitSubcommand(git, commandContext, {
    name: "checkout",
    summary: "Check out each managed repository onto its reference branch",
    description: "Check out each managed repository onto its reference branch",
    run: checkoutWorkspaceGitBranches,
  });
  registerGitSubcommand(git, commandContext, {
    name: "pull",
    summary: "Pull the current branch in each managed repository",
    description: "Pull the currently checked out branch in each managed repository",
    run: pullWorkspaceGitBranches,
  });
  registerGitSubcommand(git, commandContext, {
    name: "sync",
    summary: "Check out reference branches, then pull each managed repository",
    description: "Check out reference branches, then pull each managed repository",
    run: syncWorkspaceGitBranches,
  });
}
