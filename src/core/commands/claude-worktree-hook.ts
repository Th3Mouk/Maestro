import path from "node:path";
import { realpath } from "node:fs/promises";
import type { TaskWorktreeReport, WorktreeRemoveReport } from "../../report/types.js";
import { resolveRealPath } from "../../utils/fs.js";
import type { CommandContext } from "../command-context.js";
import { sanitizeSegment } from "../execution/task-worktree.js";
import { resolveMainWorkspaceRoot } from "../execution-support/main-workspace.js";
import { getTaskWorktreesRoot } from "../execution-support/worktree-root.js";
import { resolveWorkspace } from "../workspace-service.js";
import { createTaskWorktree, removeTaskWorktree } from "./execution.js";

/**
 * The outcome of a Claude Code `WorktreeCreate` or `WorktreeRemove` hook. Claude Code reads
 * stdout (the worktree path, for a create) and the exit code; everything else is for stderr.
 */
interface ClaudeWorktreeHookResult {
  exitCode: 0 | 1;
  /** Why the hook refused before running a command. */
  message?: string;
  report?: TaskWorktreeReport | WorktreeRemoveReport;
  stdout?: string;
}

/**
 * `WorktreeCreate`: creates the task worktree named by `name` (hooks included) and returns
 * its root as an absolute path with no symlink component, which Claude Code requires.
 */
export async function runClaudeWorktreeCreateHook(
  workspaceRoot: string,
  rawInput: string,
  context: CommandContext,
): Promise<ClaudeWorktreeHookResult> {
  const name = readStringField(rawInput, "name");
  if (name === undefined) {
    return { exitCode: 1, message: 'WorktreeCreate input must be JSON with a string "name".' };
  }
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized || /^\.+$/.test(normalized)) {
    return { exitCode: 1, message: `"${name}" is not usable as a task name.` };
  }

  const report = await createTaskWorktree(workspaceRoot, sanitizeSegment(name), {}, context);
  if (report.status === "error") {
    return { exitCode: 1, report };
  }
  return { exitCode: 0, report, stdout: await realpath(report.root) };
}

/**
 * `WorktreeRemove`: removes the task whose root is `worktree_path`, without `--force`, so a
 * task with uncommitted work stays and the hook exits 1. Any other path is refused.
 */
export async function runClaudeWorktreeRemoveHook(
  workspaceRoot: string,
  rawInput: string,
  context: CommandContext,
): Promise<ClaudeWorktreeHookResult> {
  const worktreePath = readStringField(rawInput, "worktree_path");
  if (worktreePath === undefined) {
    return {
      exitCode: 1,
      message: 'WorktreeRemove input must be JSON with a string "worktree_path".',
    };
  }

  const resolution = await resolveMainWorkspaceRoot(workspaceRoot);
  if ("error" in resolution) {
    return { exitCode: 1, message: resolution.error.message };
  }
  const mainWorkspaceRoot = resolution.workspaceRoot;
  const worktreesRoot = getTaskWorktreesRoot(
    mainWorkspaceRoot,
    await resolveWorkspace(mainWorkspaceRoot),
  );

  const candidate = await resolveRealPath(path.resolve(workspaceRoot, worktreePath));
  if (path.dirname(candidate) !== (await resolveRealPath(worktreesRoot))) {
    return {
      exitCode: 1,
      message: `${worktreePath} is not a task worktree of ${mainWorkspaceRoot} (expected ${worktreesRoot}/<task>); left untouched.`,
    };
  }

  const report = await removeTaskWorktree(mainWorkspaceRoot, path.basename(candidate), {}, context);
  return { exitCode: report.status === "ok" ? 0 : 1, report };
}

function readStringField(rawInput: string, field: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(rawInput);
    if (parsed && typeof parsed === "object" && field in parsed) {
      const value = (parsed as Record<string, unknown>)[field];
      return typeof value === "string" ? value : undefined;
    }
  } catch {
    // Invalid JSON is reported by the caller like a missing field.
  }
  return undefined;
}
