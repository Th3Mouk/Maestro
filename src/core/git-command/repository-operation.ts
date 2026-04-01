import path from "node:path";
import type { RepositoryRef } from "../../workspace/types.js";
import { resolveSafePath } from "../../utils/fs.js";
import { getRepositoryReferenceBranch } from "../../workspace/repositories.js";
import type { CommandContext } from "../command-context.js";
import { errorMessage, MaestroError } from "../errors.js";
import type { RepositoryCommandResult, WorkspaceGitCommand } from "./contracts.js";

export async function runRepositoryGitOperation(
  workspaceRoot: string,
  repository: RepositoryRef,
  command: WorkspaceGitCommand,
  context: CommandContext,
): Promise<RepositoryCommandResult> {
  const repoRoot = resolveSafePath(
    workspaceRoot,
    path.join("repos", repository.name),
    "repository root",
  );

  if (!(await context.gitAdapter.hasGitMetadata(repoRoot))) {
    return {
      repository: {
        name: repository.name,
        path: repoRoot,
        branch: command === "checkout" ? getRepositoryReferenceBranch(repository) : "unknown",
        status: "failed",
        message: "Repository not installed.",
      },
      issue: {
        code: "REPO_MISSING",
        message: `Repository not installed: ${repository.name}`,
        path: repoRoot,
      },
    };
  }

  try {
    const result = await executeGitCommand(repoRoot, repository, command, context);
    return {
      repository: {
        name: repository.name,
        path: repoRoot,
        branch: result.branch,
        status: result.status,
      },
    };
  } catch (error) {
    const branch = await getCurrentBranchForReport(repoRoot, context);
    const code = command === "checkout" ? "GIT_CHECKOUT_FAILED" : "GIT_PULL_FAILED";
    const message = errorMessage(
      new MaestroError({
        code,
        message: `${repository.name} ${command} failed`,
        path: repoRoot,
        cause: error,
      }),
    );

    return {
      repository: {
        name: repository.name,
        path: repoRoot,
        branch,
        status: "failed",
        message,
      },
      issue: {
        code,
        message: `${repository.name}: ${message}`,
        path: repoRoot,
      },
    };
  }
}

async function executeGitCommand(
  repoRoot: string,
  repository: RepositoryRef,
  command: WorkspaceGitCommand,
  context: CommandContext,
) {
  if (command === "checkout") {
    return context.gitAdapter.checkoutBranch(repoRoot, getRepositoryReferenceBranch(repository));
  }

  if (command === "pull") {
    return context.gitAdapter.pullCurrentBranch(repoRoot);
  }

  return syncWorkspaceGitRepository(repoRoot, repository, context);
}

async function getCurrentBranchForReport(
  repoRoot: string,
  context: CommandContext,
): Promise<string> {
  try {
    return await context.gitAdapter.getCurrentBranch(repoRoot);
  } catch {
    return "unknown";
  }
}

async function syncWorkspaceGitRepository(
  repoRoot: string,
  repository: RepositoryRef,
  context: CommandContext,
) {
  const checkoutResult = await context.gitAdapter.checkoutBranch(
    repoRoot,
    getRepositoryReferenceBranch(repository),
  );
  const pullResult = await context.gitAdapter.pullCurrentBranch(repoRoot);
  return {
    branch: pullResult.branch,
    status:
      checkoutResult.status === "updated" || pullResult.status === "updated"
        ? "updated"
        : "unchanged",
  } as const;
}
