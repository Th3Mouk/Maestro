import path from "node:path";
import type { WorktreeRemoveReport } from "../../report/types.js";
import { pathExists, removeIfExists, resolveSafePath } from "../../utils/fs.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import { sanitizeSegment } from "../execution/task-worktree.js";
import { escalateStatus } from "../errors.js";
import {
  listTaskRepositoryNames,
  readTaskWorktreeMetadata,
} from "../execution/task-worktree-metadata.js";
import {
  createWorktreeDirtyIssue,
  createWorktreeRemoveReport,
  findDirtyCheckouts,
  mergeRemoveRepositoryOutcomes,
  removeTaskRepositories,
  type TaskWorktreeRemoveGitAdapter,
} from "../execution/task-worktree-removal.js";
import {
  listWorktreeHookCommands,
  planWorktreeHooks,
  runWorktreeHooks,
  type WorktreeHookTrigger,
} from "../execution/worktree-hooks.js";
import { getTaskWorktreesRoot } from "./worktree-root.js";

export interface TaskWorktreeRemoveOptions {
  dryRun?: boolean;
  force?: boolean;
  /** `false` skips the `preRemove` hooks. */
  hooks?: boolean;
}

export async function removeTaskWorktreeWithResolvedWorkspace(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  taskName: string,
  options: TaskWorktreeRemoveOptions,
  context: {
    gitAdapter: TaskWorktreeRemoveGitAdapter;
    stderr?: NodeJS.WritableStream;
    /** `prune` when called for a task `prune` is removing. */
    trigger?: WorktreeHookTrigger;
  },
  concurrencyLimit: number,
): Promise<WorktreeRemoveReport> {
  const sanitizedTaskName = sanitizeSegment(taskName);
  const taskRoot = resolveSafePath(
    getTaskWorktreesRoot(workspaceRoot, resolvedWorkspace),
    sanitizedTaskName,
    "task worktree root",
  );
  const report = createWorktreeRemoveReport(
    resolvedWorkspace.manifest.metadata.name,
    taskName,
    taskRoot,
  );

  if (!(await pathExists(taskRoot))) {
    report.status = "warning";
    report.issues.push({
      code: "WORKTREE_NOT_FOUND",
      message: `No worktree found for task "${taskName}".`,
      path: taskRoot,
    });
    return report;
  }

  // The repositories the task actually holds, which may be a subset of the manifest.
  const metadata = await readTaskWorktreeMetadata(taskRoot);
  const repositoryNames = await listTaskRepositoryNames(taskRoot, metadata);
  const force = options.force ?? false;

  // A dirty task is left untouched: removing some checkouts and not others would strand work.
  if (!force) {
    const dirtyCheckouts = await findDirtyCheckouts({
      concurrencyLimit,
      generatedFiles: metadata?.generatedFiles,
      gitAdapter: context.gitAdapter,
      repositoryNames,
      taskRoot,
      workspaceName: resolvedWorkspace.manifest.metadata.name,
    });
    if (dirtyCheckouts.length > 0) {
      report.status = "error";
      report.issues.push(...dirtyCheckouts.map(createWorktreeDirtyIssue));
      return report;
    }
  }

  const hookCommands =
    options.hooks === false ? [] : listWorktreeHookCommands(resolvedWorkspace, "preRemove");
  const trigger = context.trigger ?? "remove";

  if (options.dryRun) {
    if (hookCommands.length > 0) {
      report.hooks = planWorktreeHooks(
        hookCommands,
        "preRemove",
        trigger === "prune" ? (metadata?.name ?? taskName) : undefined,
      );
    }
    for (const name of repositoryNames) {
      report.repositories.push({
        name,
        path: resolveSafePath(taskRoot, path.join("repos", name), "dry-run path"),
        status: "removed",
      });
    }
    report.workspaceRootStatus = "removed";
    return report;
  }

  // The teardown runs once the safety checks passed and before anything is removed.
  if (hookCommands.length > 0) {
    const { failure, runs } = await runWorktreeHooks(hookCommands, {
      hook: "preRemove",
      stderr: context.stderr ?? process.stderr,
      task: { name: metadata?.name ?? taskName, repositories: repositoryNames, root: taskRoot },
      trigger,
      workspaceRoot,
    });
    report.hooks = runs;
    if (failure) {
      report.issues.push({ code: "HOOK_FAILED", message: failure.message, path: taskRoot });
      if (!force) {
        report.status = "error";
        return report;
      }
      report.status = escalateStatus(report.status, "warning");
    }
  }

  const outcomes = await removeTaskRepositories({
    concurrencyLimit,
    force,
    gitAdapter: context.gitAdapter,
    repositoryNames,
    taskRoot,
    workspaceRoot,
  });
  if (outcomes.some((outcome) => outcome.issue)) {
    report.status = escalateStatus(report.status, "warning");
  }
  mergeRemoveRepositoryOutcomes(report, outcomes);

  const repositoriesRemoved = report.repositories.every(
    (repository) => repository.status !== "failed",
  );
  if (!repositoriesRemoved && !force) {
    // Removing the root would delete the repository worktrees still nested under it.
    report.workspaceRootStatus = "skipped";
  } else if (await context.gitAdapter.hasGitMetadata(taskRoot)) {
    try {
      // The dirty check passed, so what remains in the root is what Maestro wrote there,
      // which a plain `git worktree remove` would still refuse.
      const status = await context.gitAdapter.removeWorktree(workspaceRoot, taskRoot, {
        force: true,
      });
      report.workspaceRootStatus = status;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      report.workspaceRootStatus = "failed";
      report.status = escalateStatus(report.status, "warning");
      report.issues.push({
        code: "WORKTREE_ROOT_REMOVE_FAILED",
        message: `Failed to remove workspace-root worktree: ${message}`,
        path: taskRoot,
      });
    }
  } else {
    report.workspaceRootStatus = "missing";
  }

  // Deleting the task root wipes whatever a failed `git worktree remove` left behind,
  // so it only runs once every removal succeeded, or under --force.
  const everyRemovalSucceeded =
    repositoriesRemoved &&
    report.workspaceRootStatus !== "failed" &&
    report.workspaceRootStatus !== "skipped";
  if ((everyRemovalSucceeded || force) && (await pathExists(taskRoot))) {
    await removeIfExists(taskRoot);
  }

  return report;
}
