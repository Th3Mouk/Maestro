import { Argument, Option, type Command } from "commander";
import {
  runClaudeWorktreeCreateHook,
  runClaudeWorktreeRemoveHook,
} from "../../../core/commands/claude-worktree-hook.js";
import { createRenderer, resolveFormat } from "../../output/index.js";
import type { WorktreeOpenReport } from "../../../report/types.js";
import {
  createTaskWorktree,
  getTaskWorktreePath,
  listTaskWorktrees,
  openTaskWorktree,
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
import { readStdin } from "./stdin.js";
import { pickTask } from "./task-picker.js";

function collectTaskName(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

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
        "  maestro worktree open fix-login --editor cursor",
        '  cd "$(maestro worktree path fix-login)"',
        "  maestro worktree remove --task release-prep",
        "  maestro worktree prune --dry-run",
        "  maestro worktree prune --task release-prep",
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
        )
        .option("--no-hooks", "skip the postCreate hooks"),
      "preview without writing (lists the hooks that would run)",
    ),
  ).action(
    async (
      options: OutputOptionValues & {
        workspace: string;
        task: string;
        repos?: string;
        offline?: boolean;
        hooks: boolean;
        dryRun?: boolean;
      },
    ) => {
      await runReportAction(options, "worktree-create", () =>
        createTaskWorktree(
          resolveWorkspacePath(options.workspace),
          options.task,
          {
            dryRun: options.dryRun,
            hooks: options.hooks,
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
          "force removal even if worktrees have uncommitted changes (discards them); preRemove hooks still run",
          false,
        )
        .option("--no-hooks", "skip the preRemove hooks"),
      "preview without writing (lists the hooks that would run)",
    ),
  ).action(
    async (
      options: OutputOptionValues & {
        workspace: string;
        task: string;
        force?: boolean;
        hooks: boolean;
        dryRun?: boolean;
      },
    ) => {
      await runReportAction(options, "worktree-remove", () =>
        removeTaskWorktree(
          resolveWorkspacePath(options.workspace),
          options.task,
          { force: options.force, dryRun: options.dryRun, hooks: options.hooks },
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
        )
        .addOption(
          new Option(
            "--forge <name>",
            "ask the forge whether branches whose upstream is gone were merged (github), or turn spec.execution.worktrees.forge off (none)",
          ).choices(["github", "none"]),
        ),
    ),
  ).action(
    async (
      options: OutputOptionValues & {
        workspace: string;
        status?: boolean;
        forge?: "github" | "none";
      },
    ) => {
      await runReportAction(options, "worktree-list", () =>
        listTaskWorktrees(
          resolveWorkspacePath(options.workspace),
          { forge: options.forge, status: options.status },
          commandContext,
        ),
      );
    },
  );

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
        .option(
          "--task <name>",
          "only check and prune this task (repeatable); with --branches, only its orphan branches",
          collectTaskName,
        )
        .option("--branches", "also delete orphan task branches that no task worktree holds")
        .addOption(
          new Option(
            "--forge <name>",
            "ask the forge whether branches whose upstream is gone were merged (github), or turn spec.execution.worktrees.forge off (none)",
          ).choices(["github", "none"]),
        )
        .option("--no-fetch", "skip `git fetch --prune` on the workspace and each repository")
        .option("--no-hooks", "skip the preRemove hooks of the removed tasks"),
      "print the plan, hooks included, without removing anything",
    ),
  ).action(
    async (
      options: OutputOptionValues & {
        workspace: string;
        dryRun?: boolean;
        includeGone?: boolean;
        branches?: boolean;
        fetch: boolean;
        hooks: boolean;
        forge?: "github" | "none";
        task?: string[];
      },
    ) => {
      await runReportAction(options, "worktree-prune", () =>
        pruneTaskWorktrees(
          resolveWorkspacePath(options.workspace),
          {
            branches: options.branches,
            dryRun: options.dryRun,
            fetch: options.fetch,
            forge: options.forge,
            hooks: options.hooks,
            includeGone: options.includeGone,
            tasks: options.task,
          },
          commandContext,
        ),
      );
    },
  );

  addWorkspaceOption(
    worktree
      .command("hook")
      .summary("Claude Code WorktreeCreate/WorktreeRemove hook adapter")
      .description(
        [
          "Run as a Claude Code command hook. Reads the hook input (JSON) on stdin.",
          "claude-create: creates the task worktree named by `name` (postCreate hooks included) and prints only its absolute root on stdout.",
          "claude-remove: removes the task at `worktree_path` without --force; exits 1 and keeps it when it holds uncommitted work or is not a task of this workspace.",
          "Reports go to stderr. `runtimes.claude-code.worktreeHooks: true` wires both into .claude/settings.json.",
        ].join("\n"),
      )
      .addArgument(
        new Argument("<event>", "hook event").choices(["claude-create", "claude-remove"]),
      ),
  ).action(async (event: "claude-create" | "claude-remove", options: { workspace: string }) => {
    const run =
      event === "claude-create" ? runClaudeWorktreeCreateHook : runClaudeWorktreeRemoveHook;
    try {
      const result = await run(
        resolveWorkspacePath(options.workspace),
        await readStdin(),
        commandContext,
      );
      if (result.report) {
        createRenderer("human", {
          reportKind: event === "claude-create" ? "worktree-create" : "worktree-remove",
        }).render(result.report, process.stderr);
      }
      if (result.message) {
        process.stderr.write(`maestro worktree hook ${event}: ${result.message}\n`);
      }
      if (result.stdout !== undefined) {
        process.stdout.write(`${result.stdout}\n`);
      }
      process.exitCode = result.exitCode;
    } catch (error) {
      process.stderr.write(
        `maestro worktree hook ${event}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exitCode = 1;
    }
  });

  addWorkspaceOption(
    worktree
      .command("path")
      .summary("Print the absolute root of a task worktree")
      .description(
        "Print the absolute root of a task worktree on stdout (@root for the main workspace). Without a task, pick one interactively (fzf when available); without a terminal, the task is required.",
      )
      .argument("[task]", "task name, or @root for the main workspace"),
  ).action(
    async (task: string | undefined, options: OutputOptionValues & { workspace: string }) => {
      await printTaskRoot("path", options, () =>
        getTaskWorktreePath(
          resolveWorkspacePath(options.workspace),
          task,
          { pick: interactivePicker() },
          commandContext,
        ),
      );
    },
  );

  addOutputOptions(
    addWorkspaceOption(
      worktree
        .command("open")
        .summary("Open a task worktree in an editor, then print its root")
        .description(
          "Open a task worktree in an editor (--editor, else $MAESTRO_EDITOR, else spec.execution.worktrees.editor, else vscode), then print its absolute root on stdout. The report goes to stderr. Without a task, pick one interactively.",
        )
        .argument("[task]", "task name, or @root for the main workspace")
        .option(
          "--editor <id>",
          "vscode, cursor, devin, phpstorm, idea, webstorm, none, or custom ($MAESTRO_EDITOR_COMMAND with {root} and {workspaceFile})",
        )
        .option(
          "--create",
          "create the task first (postCreate hooks included) when it does not exist",
        ),
    ),
  ).action(
    async (
      task: string | undefined,
      options: OutputOptionValues & { workspace: string; editor?: string; create?: boolean },
    ) => {
      await printTaskRoot("open", options, () =>
        openTaskWorktree(
          resolveWorkspacePath(options.workspace),
          task,
          { create: options.create, editor: options.editor, pick: interactivePicker() },
          commandContext,
        ),
      );
    },
  );
}

/** The picker, only when a human can answer it. */
function interactivePicker() {
  return process.stdin.isTTY && process.stderr.isTTY ? pickTask : undefined;
}

/**
 * Prints only the task root on stdout, so `cd "$(maestro worktree path …)"` works. For
 * `open`, the report goes to stderr (human unless --format json); failures always do.
 */
async function printTaskRoot(
  command: "path" | "open",
  options: OutputOptionValues,
  run: () => Promise<WorktreeOpenReport>,
): Promise<void> {
  try {
    const report = await run();
    if (command === "open" || report.status === "error") {
      const format = resolveFormat({
        formatFlag: options.format,
        jsonFlag: options.json,
        env: {},
        isTTY: true,
      });
      createRenderer(format, {
        reportKind: command === "open" ? "worktree-open" : "worktree-path",
        color: options.color !== false && Boolean(process.stderr.isTTY),
      }).render(report, process.stderr);
    }
    if (report.status !== "error") {
      process.stdout.write(`${report.root}\n`);
    }
    process.exitCode = report.status === "error" ? 1 : 0;
  } catch (error) {
    process.stderr.write(
      `maestro worktree ${command}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
