import path from "node:path";
import { readFile } from "node:fs/promises";
import type { WorktreeRemoveReport, WorktreeListReport } from "../../report/types.js";
import { listDirectories, pathExists, removeIfExists, resolveSafePath } from "../../utils/fs.js";
import { workspaceStateDirName } from "../../workspace/state-directory.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import { sanitizeSegment } from "../execution/task-worktree.js";
import { escalateStatus } from "../errors.js";
import {
  createWorktreeDirtyIssue,
  createWorktreeRemoveReport,
  findDirtyCheckouts,
  mergeRemoveRepositoryOutcomes,
  removeTaskRepositories,
  type TaskWorktreeRemoveGitAdapter,
} from "../execution/task-worktree-removal.js";
import { getTaskWorktreesRoot } from "./worktree-root.js";

export async function removeTaskWorktreeWithResolvedWorkspace(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  taskName: string,
  options: { force?: boolean; dryRun?: boolean },
  context: { gitAdapter: TaskWorktreeRemoveGitAdapter },
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

  const repositoryNames = resolvedWorkspace.repositories.map((repository) => repository.name);
  const force = options.force ?? false;

  // A dirty task is left untouched: removing some checkouts and not others would strand work.
  if (!force) {
    const dirtyCheckouts = await findDirtyCheckouts({
      concurrencyLimit,
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

  if (options.dryRun) {
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

  if (await context.gitAdapter.hasGitMetadata(taskRoot)) {
    try {
      const status = await context.gitAdapter.removeWorktree(workspaceRoot, taskRoot, { force });
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
    report.workspaceRootStatus !== "failed" &&
    report.repositories.every((repository) => repository.status !== "failed");
  if ((everyRemovalSucceeded || force) && (await pathExists(taskRoot))) {
    await removeIfExists(taskRoot);
  }

  return report;
}

export async function listTaskWorktreesWithResolvedWorkspace(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
): Promise<WorktreeListReport> {
  const worktreesRoot = getTaskWorktreesRoot(workspaceRoot, resolvedWorkspace);
  const report: WorktreeListReport = {
    status: "ok",
    workspace: resolvedWorkspace.manifest.metadata.name,
    worktrees: [],
    issues: [],
  };

  if (!(await pathExists(worktreesRoot))) {
    return report;
  }

  const names = await listDirectories(worktreesRoot);
  for (const name of names) {
    const root = path.join(worktreesRoot, name);
    const metadataPath = path.join(root, workspaceStateDirName, "execution", "worktree.json");
    let createdAt = "";
    let taskName = name;
    try {
      const raw = await readFile(metadataPath, "utf8");
      const parsed = JSON.parse(raw) as { name?: string; createdAt?: string };
      taskName = parsed.name ?? name;
      createdAt = parsed.createdAt ?? "";
    } catch {
      report.status = escalateStatus(report.status, "warning");
      report.issues.push({
        code: "WORKTREE_METADATA_MISSING",
        message: `No metadata found for worktree "${name}".`,
        path: metadataPath,
      });
    }
    report.worktrees.push({ name: taskName, root, createdAt });
  }

  return report;
}
