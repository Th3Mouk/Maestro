import path from "node:path";
import { readFile } from "node:fs/promises";
import type { WorktreeRemoveReport, WorktreeListReport } from "../../report/types.js";
import { listDirectories, pathExists, removeIfExists, resolveSafePath } from "../../utils/fs.js";
import { workspaceStateDirName } from "../../workspace/state-directory.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import { sanitizeSegment } from "../execution/task-worktree.js";
import { escalateStatus } from "../errors.js";
import {
  createWorktreeRemoveReport,
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

  if (options.dryRun) {
    for (const repository of resolvedWorkspace.repositories) {
      report.repositories.push({
        name: repository.name,
        path: resolveSafePath(taskRoot, path.join("repos", repository.name), "dry-run path"),
        status: "removed",
      });
    }
    report.workspaceRootStatus = "removed";
    return report;
  }

  const outcomes = await removeTaskRepositories({
    concurrencyLimit,
    force: options.force ?? false,
    gitAdapter: context.gitAdapter,
    repositories: resolvedWorkspace.repositories,
    taskRoot,
    workspaceRoot,
  });
  if (outcomes.some((outcome) => outcome.issue)) {
    report.status = escalateStatus(report.status, "warning");
  }
  mergeRemoveRepositoryOutcomes(report, outcomes);

  if (await context.gitAdapter.hasGitMetadata(taskRoot)) {
    try {
      const status = await context.gitAdapter.removeWorktree(workspaceRoot, taskRoot, {
        force: options.force,
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

  if (await pathExists(taskRoot)) {
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
