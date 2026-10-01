import path from "node:path";
import type { TaskWorktreeCheckoutStatus, TaskWorktreeReport } from "../../report/types.js";
import type { RepositoryRef } from "../../workspace/types.js";
import { ensureDir, mapWithConcurrency, resolveSafePath } from "../../utils/fs.js";
import { getRepositoryReferenceBranch } from "../../workspace/repositories.js";
import { errorMessage } from "../errors.js";
import { createTaskBranchName } from "./task-worktree.js";

export type TaskWorktreeGitAdapter = {
  fetchBranch: (repoRoot: string, branchName: string) => Promise<void>;
  hasGitMetadata: (repoRoot: string) => Promise<boolean>;
  localBranchExists: (repoRoot: string, branchName: string) => Promise<boolean>;
  remoteBranchExists: (repoRoot: string, branchName: string) => Promise<boolean>;
  resolveDefaultBranchRef: (repoRoot: string) => Promise<string>;
  ensureWorktree: (
    repoRoot: string,
    worktreePath: string,
    branchName: string,
    baseRef?: string,
    dryRun?: boolean,
  ) => Promise<TaskWorktreeCheckoutStatus>;
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
  /** Keep the local reference branch as the base instead of fetching `origin/<branch>`. */
  offline?: boolean;
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
    // The workspace's default branch, not whatever branch the root checkout sits on.
    await options.gitAdapter.ensureWorktree(
      options.workspaceRoot,
      options.taskRoot,
      createTaskBranchName(options.branchPrefix, options.taskName, options.workspaceName),
      await options.gitAdapter.resolveDefaultBranchRef(options.workspaceRoot),
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
    const base = await resolveRepositoryBaseRef({
      branch,
      gitAdapter: options.gitAdapter,
      offline: options.offline ?? false,
      referenceBranch: getRepositoryReferenceBranch(repository),
      repositoryName: repository.name,
      sourceRepoRoot,
      targetRepoRoot,
    });
    const status = await options.gitAdapter.ensureWorktree(
      sourceRepoRoot,
      targetRepoRoot,
      branch,
      base.ref,
    );

    return {
      issue: base.issue,
      repository: {
        branch,
        name: repository.name,
        path: targetRepoRoot,
        status,
      },
    };
  });
}

/**
 * New task branches start from `origin/<reference>`, fetched first unless offline, so a stale
 * local reference branch does not silently become the task's base. An existing task branch
 * or worktree is reused as is, so nothing is fetched for it.
 */
async function resolveRepositoryBaseRef(options: {
  branch: string;
  gitAdapter: TaskWorktreeGitAdapter;
  offline: boolean;
  referenceBranch: string;
  repositoryName: string;
  sourceRepoRoot: string;
  targetRepoRoot: string;
}): Promise<{ issue?: TaskWorktreeReport["issues"][number]; ref: string }> {
  const { gitAdapter, referenceBranch, sourceRepoRoot } = options;
  if (
    (await gitAdapter.hasGitMetadata(options.targetRepoRoot)) ||
    (await gitAdapter.localBranchExists(sourceRepoRoot, options.branch))
  ) {
    return { ref: referenceBranch };
  }

  let issue: TaskWorktreeReport["issues"][number] | undefined;
  if (!options.offline) {
    try {
      await gitAdapter.fetchBranch(sourceRepoRoot, referenceBranch);
    } catch (error) {
      issue = {
        code: "FETCH_FAILED",
        message: `Could not fetch origin/${referenceBranch} for ${options.repositoryName}; the local ${referenceBranch} is used as the base: ${errorMessage(error)}`,
        path: sourceRepoRoot,
      };
    }
  }

  if (!issue && (await gitAdapter.remoteBranchExists(sourceRepoRoot, referenceBranch))) {
    return { ref: `origin/${referenceBranch}` };
  }
  return { issue, ref: referenceBranch };
}

export function mergeTaskRepositoryOutcomes(
  report: TaskWorktreeReport,
  outcomes: TaskRepositoryOutcome[],
): void {
  for (const outcome of outcomes) {
    if (outcome.issue) {
      report.issues.push(outcome.issue);
    }

    if (outcome.repository) {
      report.repositories.push(outcome.repository);
    }
  }
}
