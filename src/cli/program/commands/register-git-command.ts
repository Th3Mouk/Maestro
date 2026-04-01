import type { Command } from "commander";
import {
  checkoutWorkspaceGitBranches,
  pullWorkspaceGitBranches,
  syncWorkspaceGitBranches,
} from "../../../core/commands/workspace-git.js";
import { addWorkspaceOption, resolveWorkspacePath } from "../shared-options.js";
import type { CommandContext } from "./command-types.js";
import { writeJsonStdout } from "./command-helpers.js";

type GitCommandReport = { status: string };

type GitSubcommandRunner = (
  workspacePath: string,
  commandContext: CommandContext,
) => Promise<GitCommandReport>;

function registerGitSubcommand(
  git: Command,
  commandContext: CommandContext,
  options: {
    name: string;
    summary: string;
    description: string;
    run: GitSubcommandRunner;
  },
): void {
  addWorkspaceOption(
    git.command(options.name).summary(options.summary).description(options.description),
  ).action(async (commandOptions: { workspace: string }) => {
    const report = await options.run(
      resolveWorkspacePath(commandOptions.workspace),
      commandContext,
    );
    await writeJsonStdout(report);
    process.exitCode = report.status === "ok" ? 0 : 1;
  });
}

export function registerGitCommand(program: Command, commandContext: CommandContext): void {
  const git = program
    .command("git")
    .summary("Run workspace-scoped Git operations across managed repositories")
    .description("Run bulk Git operations across managed repositories in the workspace")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  maestro git checkout --workspace .",
        "  maestro git pull --workspace .",
        "  maestro git sync --workspace ./examples/ops-workspace",
      ].join("\n"),
    );

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
