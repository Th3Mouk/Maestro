import path from "node:path";
import type { WorktreeRemoveReport } from "../../report/types.js";
import type { RepositoryRef } from "../../workspace/types.js";
import { mapWithConcurrency, resolveSafePath } from "../../utils/fs.js";

export type TaskWorktreeRemoveGitAdapter = {
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
  repositories: RepositoryRef[];
  taskRoot: string;
  workspaceRoot: string;
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
  return mapWithConcurrency(options.repositories, options.concurrencyLimit, async (repository) => {
    const sourceRepoRoot = resolveSafePath(
      options.workspaceRoot,
      path.join("repos", repository.name),
      "workspace repository path",
    );
    const worktreePath = resolveSafePath(
      options.taskRoot,
      path.join("repos", repository.name),
      "task repository path",
    );

    if (!(await options.gitAdapter.hasGitMetadata(sourceRepoRoot))) {
      return {
        repository: { name: repository.name, path: worktreePath, status: "skipped" as const },
        issue: {
          code: "REPO_MISSING",
          message: `Source repository not installed: ${repository.name}`,
          path: sourceRepoRoot,
        },
      };
    }

    try {
      const status = await options.gitAdapter.removeWorktree(sourceRepoRoot, worktreePath, {
        force: options.force,
      });
      return {
        repository: { name: repository.name, path: worktreePath, status },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        repository: {
          name: repository.name,
          path: worktreePath,
          status: "failed" as const,
          message,
        },
        issue: {
          code: "WORKTREE_REMOVE_FAILED",
          message: `Failed to remove worktree for ${repository.name}: ${message}`,
          path: worktreePath,
        },
      };
    }
  });
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
