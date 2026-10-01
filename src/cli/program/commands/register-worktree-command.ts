import type { Command } from "commander";
import {
  createTaskWorktree,
  listTaskWorktrees,
  pruneTaskWorktrees,
  removeTaskWorktree,
} from "../../../core/commands/execution.js";
import {
  addOutputOptions,
  addWorkspaceAndDryRunOptions,
  addWorkspaceOption,
  resolveWorkspacePath,
  type OutputOptionValues,
} from "../shared-options.js";
import type { CommandContext } from "./command-types.js";
import { parseNameList, runReportAction } from "./command-helpers.js";

export function registerWorktreeCommand(program: Command, commandContext: CommandContext): void {
  const worktree = program
    .command("worktree")
    .summary("Create, list, remove, and prune isolated task worktrees")
    .description("Manage isolated task worktrees spanning the workspace and managed repositories")
    .addHelpText(
      "after",
      [
        "",
        "Examples:",
        "  maestro worktree create --task release-prep",
        "  maestro worktree create --task fix-login --repos foods,platform-api",
        "  maestro worktree list --status",
        "  maestro worktree remove --task release-prep",
        "  maestro worktree prune --dry-run",
      ].join("\n"),
    );

  addOutputOptions(
    addWorkspaceAndDryRunOptions(
      worktree
        .command("create")
        .summary("Create an isolated task worktree across the managed repositories")
        .description(
          "Create an isolated task worktree for the workspace and its managed repositories",
        )
        .requiredOption("--task <name>", "task or worktree name")
        .option(
          "--repos <names>",
          "comma-separated repositories to check out (default: every managed repository); on an existing task, adds the missing ones",
        )
        .option(
          "--offline",
          "do not fetch: base new task branches on the local reference branches instead of origin",
        ),
      "preview without writing",
    ),
  ).action(
    async (
      options: OutputOptionValues & {
        workspace: string;
        task: string;
        repos?: string;
        offline?: boolean;
        dryRun?: boolean;
      },
    ) => {
      await runReportAction(options, "worktree-create", () =>
        createTaskWorktree(
          resolveWorkspacePath(options.workspace),
          options.task,
          {
            dryRun: options.dryRun,
            offline: options.offline,
            repos: parseNameList(options.repos),
          },
          commandContext,
        ),
      );
    },
  );

  addOutputOptions(
    addWorkspaceAndDryRunOptions(
      worktree
        .command("remove")
        .summary("Remove an isolated task worktree across the managed repositories")
        .description(
          "Remove the task worktree for the workspace and its managed repositories. Committed work remains on the task branches. A task with uncommitted changes or untracked files in any checkout is left untouched unless --force is passed.",
        )
        .requiredOption("--task <name>", "task or worktree name")
        .option(
          "--force",
          "force removal even if worktrees have uncommitted changes (discards them)",
          false,
        ),
      "preview without writing",
    ),
  ).action(
    async (
      options: OutputOptionValues & {
        workspace: string;
        task: string;
        force?: boolean;
        dryRun?: boolean;
      },
    ) => {
      await runReportAction(options, "worktree-remove", () =>
        removeTaskWorktree(
          resolveWorkspacePath(options.workspace),
          options.task,
          { force: options.force, dryRun: options.dryRun },
          commandContext,
        ),
      );
    },
  );

  addOutputOptions(
    addWorkspaceOption(
      worktree
        .command("list")
        .summary("List existing task worktrees for this workspace")
        .description(
          "Enumerate task worktrees with their creation time, root path, and repositories",
        )
        .option(
          "--status",
          "inspect each checkout: branch, uncommitted changes, local-only commits, upstream, integration, and whether prune would remove the task",
        ),
    ),
  ).action(async (options: OutputOptionValues & { workspace: string; status?: boolean }) => {
    await runReportAction(options, "worktree-list", () =>
      listTaskWorktrees(
        resolveWorkspacePath(options.workspace),
        { status: options.status },
        commandContext,
      ),
    );
  });

  addOutputOptions(
    addWorkspaceAndDryRunOptions(
      worktree
        .command("prune")
        .summary("Remove task worktrees whose work has landed")
        .description(
          "Remove every task whose checkouts are clean and hold no work missing from a remote or the reference branch, then delete its task branches. Unsafe tasks are kept and listed with their reasons.",
        )
        .option(
          "--include-gone",
          "also prune clean branches whose upstream was deleted (a deleted remote branch is not proof the work landed)",
        )
        .option("--branches", "also delete orphan task branches that no task worktree holds")
        .option("--no-fetch", "skip `git fetch --prune` on the workspace and each repository"),
      "print the plan without removing anything",
    ),
  ).action(
    async (
      options: OutputOptionValues & {
        workspace: string;
        dryRun?: boolean;
        includeGone?: boolean;
        branches?: boolean;
        fetch: boolean;
      },
    ) => {
      await runReportAction(options, "worktree-prune", () =>
        pruneTaskWorktrees(
          resolveWorkspacePath(options.workspace),
          {
            branches: options.branches,
            dryRun: options.dryRun,
            fetch: options.fetch,
            includeGone: options.includeGone,
          },
          commandContext,
        ),
      );
    },
  );
}
