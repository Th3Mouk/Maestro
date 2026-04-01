import path from "node:path";
import type { TaskWorktreeReport } from "../../report/types.js";
import type { RepositoryRef } from "../../workspace/types.js";
import { ensureDir, mapWithConcurrency, resolveSafePath } from "../../utils/fs.js";
import { getRepositoryReferenceBranch } from "../../workspace/repositories.js";
import { createTaskBranchName } from "./task-worktree.js";

export type TaskWorktreeGitAdapter = {
  hasGitMetadata: (repoRoot: string) => Promise<boolean>;
  ensureWorktree: (
    repoRoot: string,
    worktreePath: string,
    branchName: string,
    baseRef?: string,
    dryRun?: boolean,
  ) => Promise<"created" | "updated" | "unchanged">;
};

interface PrepareTaskWorkspaceRootOptions {
  branchPrefix?: string;
  gitAdapter: TaskWorktreeGitAdapter;
  taskName: string;
  taskRoot: string;
  workspaceName: string;
  workspaceRoot: string;
}

interface PrepareTaskRepositoriesOptions {
  branchPrefix?: string;
  concurrencyLimit: number;
  gitAdapter: TaskWorktreeGitAdapter;
  repositories: RepositoryRef[];
  taskName: string;
  taskRoot: string;
  workspaceRoot: string;
}

interface TaskRepositoryOutcome {
  issue?: TaskWorktreeReport["issues"][number];
  repository?: TaskWorktreeReport["repositories"][number];
}

export function createTaskWorktreeReport(
  workspaceName: string,
  taskName: string,
  taskRoot: string,
): TaskWorktreeReport {
  return {
    status: "ok",
    workspace: workspaceName,
    name: taskName,
    root: taskRoot,
    repositories: [],
    issues: [],
  };
}

export function createWorktreesDisabledIssue(): TaskWorktreeReport["issues"][number] {
  return {
    code: "WORKTREES_DISABLED",
    message: "Task worktrees are disabled in spec.execution.worktrees.",
  };
}

export function createDryRunTaskRepositories(options: {
  branchPrefix?: string;
  repositories: RepositoryRef[];
  taskName: string;
  taskRoot: string;
}): TaskWorktreeReport["repositories"] {
  return options.repositories.map((repository) => ({
    branch: createTaskBranchName(options.branchPrefix, options.taskName, repository.name),
    name: repository.name,
    path: resolveSafePath(
      options.taskRoot,
      path.join("repos", repository.name),
      "task repository path",
    ),
    status: "created",
  }));
}

export async function prepareTaskWorkspaceRoot(
  options: PrepareTaskWorkspaceRootOptions,
): Promise<TaskWorktreeReport["issues"][number] | undefined> {
  await ensureDir(path.dirname(options.taskRoot));

  if (await options.gitAdapter.hasGitMetadata(options.workspaceRoot)) {
    await options.gitAdapter.ensureWorktree(
      options.workspaceRoot,
      options.taskRoot,
      createTaskBranchName(options.branchPrefix, options.taskName, options.workspaceName),
      "HEAD",
    );
    return undefined;
  }

  await ensureDir(options.taskRoot);
  return {
    code: "WORKSPACE_GIT_MISSING",
    message:
      "The workspace root is not a Git repository. Artifacts will be copied without a Git worktree for the root.",
    path: options.workspaceRoot,
  };
}

export async function prepareTaskRepositories(
  options: PrepareTaskRepositoriesOptions,
): Promise<TaskRepositoryOutcome[]> {
  return mapWithConcurrency(options.repositories, options.concurrencyLimit, async (repository) => {
    const sourceRepoRoot = resolveSafePath(
      options.workspaceRoot,
      path.join("repos", repository.name),
      "workspace repository path",
    );
    const targetRepoRoot = resolveSafePath(
      options.taskRoot,
      path.join("repos", repository.name),
      "task repository path",
    );
    if (!(await options.gitAdapter.hasGitMetadata(sourceRepoRoot))) {
      return {
        issue: {
          code: "REPO_MISSING",
          message: `Repository not installed: ${repository.name}`,
          path: sourceRepoRoot,
        },
      };
    }

    const branch = createTaskBranchName(options.branchPrefix, options.taskName, repository.name);
    const status = await options.gitAdapter.ensureWorktree(
      sourceRepoRoot,
      targetRepoRoot,
      branch,
      getRepositoryReferenceBranch(repository),
    );

    return {
      repository: {
        branch,
        name: repository.name,
        path: targetRepoRoot,
        status,
      },
    };
  });
}

export function mergeTaskRepositoryOutcomes(
  report: TaskWorktreeReport,
  outcomes: TaskRepositoryOutcome[],
): void {
  for (const outcome of outcomes) {
    if (outcome.issue) {
      report.issues.push(outcome.issue);
      continue;
    }

    if (outcome.repository) {
      report.repositories.push(outcome.repository);
    }
  }
}
