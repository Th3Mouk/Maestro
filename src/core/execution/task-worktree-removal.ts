import path from "node:path";
import type { WorktreeRemoveReport } from "../../report/types.js";
import { mapWithConcurrency, resolveSafePath } from "../../utils/fs.js";
import { errorMessage } from "../errors.js";
import {
  excludeGeneratedChanges,
  type GeneratedFileFingerprints,
} from "./task-worktree-generated-files.js";

export type TaskWorktreeRemoveGitAdapter = {
  listUncommittedChanges: (repoRoot: string) => Promise<string[]>;
  hasGitMetadata: (repoRoot: string) => Promise<boolean>;
  removeWorktree: (
    repoRoot: string,
    worktreePath: string,
    options?: { force?: boolean },
  ) => Promise<"removed" | "missing">;
};

interface RemoveTaskRepositoriesOptions {
  concurrencyLimit: number;
  force: boolean;
  gitAdapter: TaskWorktreeRemoveGitAdapter;
  repositoryNames: string[];
  taskRoot: string;
  workspaceRoot: string;
}

interface DirtyCheckout {
  changedFiles: number;
  error?: string;
  name: string;
  path: string;
}

interface RemoveTaskRepositoryOutcome {
  issue?: WorktreeRemoveReport["issues"][number];
  repository: WorktreeRemoveReport["repositories"][number];
}

export function createWorktreeRemoveReport(
  workspaceName: string,
  taskName: string,
  taskRoot: string,
): WorktreeRemoveReport {
  return {
    status: "ok",
    workspace: workspaceName,
    name: taskName,
    root: taskRoot,
    repositories: [],
    workspaceRootStatus: "skipped",
    issues: [],
  };
}

export async function removeTaskRepositories(
  options: RemoveTaskRepositoriesOptions,
): Promise<RemoveTaskRepositoryOutcome[]> {
  return mapWithConcurrency(options.repositoryNames, options.concurrencyLimit, async (name) => {
    const sourceRepoRoot = resolveSafePath(
      options.workspaceRoot,
      path.join("repos", name),
      "workspace repository path",
    );
    const worktreePath = resolveSafePath(
      options.taskRoot,
      path.join("repos", name),
      "task repository path",
    );

    if (!(await options.gitAdapter.hasGitMetadata(sourceRepoRoot))) {
      return {
        repository: { name, path: worktreePath, status: "skipped" as const },
        issue: {
          code: "REPO_MISSING",
          message: `Source repository not installed: ${name}`,
          path: sourceRepoRoot,
        },
      };
    }

    try {
      const status = await options.gitAdapter.removeWorktree(sourceRepoRoot, worktreePath, {
        force: options.force,
      });
      return {
        repository: { name, path: worktreePath, status },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        repository: {
          name,
          path: worktreePath,
          status: "failed" as const,
          message,
        },
        issue: {
          code: "WORKTREE_REMOVE_FAILED",
          message: `Failed to remove worktree for ${name}: ${message}`,
          path: worktreePath,
        },
      };
    }
  });
}

/**
 * Lists the task checkouts (workspace root first, then each repository) that hold uncommitted
 * work. Untracked files count; ignored files (`vendor/`, `node_modules/`) do not.
 */
export async function findDirtyCheckouts(options: {
  concurrencyLimit: number;
  generatedFiles?: GeneratedFileFingerprints;
  gitAdapter: TaskWorktreeRemoveGitAdapter;
  repositoryNames: string[];
  taskRoot: string;
  workspaceName: string;
}): Promise<DirtyCheckout[]> {
  const checkouts = [
    { name: options.workspaceName, path: options.taskRoot },
    ...options.repositoryNames.map((name) => ({
      name,
      path: resolveSafePath(options.taskRoot, path.join("repos", name), "task repository path"),
    })),
  ];
  const counted = await mapWithConcurrency(
    checkouts,
    options.concurrencyLimit,
    async (checkout) => {
      if (!(await options.gitAdapter.hasGitMetadata(checkout.path))) {
        return { ...checkout, changedFiles: 0 };
      }
      try {
        const changes = await options.gitAdapter.listUncommittedChanges(checkout.path);
        // Only the workspace-root checkout receives files written by Maestro.
        const userChanges =
          checkout.path === options.taskRoot
            ? await excludeGeneratedChanges(options.taskRoot, changes, options.generatedFiles)
            : changes;
        return { ...checkout, changedFiles: userChanges.length };
      } catch (error) {
        // A checkout Git cannot read cannot be proven clean.
        return { ...checkout, changedFiles: 0, error: errorMessage(error) };
      }
    },
  );
  return counted.filter((checkout) => checkout.changedFiles > 0 || "error" in checkout);
}

export function createWorktreeDirtyIssue(
  checkout: DirtyCheckout,
): WorktreeRemoveReport["issues"][number] {
  if (checkout.error) {
    return {
      code: "WORKTREE_DIRTY",
      message: `${checkout.name} could not be checked for uncommitted changes (${checkout.error}); pass --force to remove it anyway.`,
      path: checkout.path,
    };
  }
  const noun = checkout.changedFiles === 1 ? "change" : "changes";
  return {
    code: "WORKTREE_DIRTY",
    message: `${checkout.name} has ${checkout.changedFiles} uncommitted ${noun}; commit or stash them, or pass --force to discard them.`,
    path: checkout.path,
    changedFiles: checkout.changedFiles,
  };
}

export function mergeRemoveRepositoryOutcomes(
  report: WorktreeRemoveReport,
  outcomes: RemoveTaskRepositoryOutcome[],
): void {
  for (const outcome of outcomes) {
    report.repositories.push(outcome.repository);
    if (outcome.issue) {
      report.issues.push(outcome.issue);
    }
  }
}
