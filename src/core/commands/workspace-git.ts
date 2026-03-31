import path from "node:path";
import type { WorkspaceGitReport } from "../../report/types.js";
import type { RepositoryRef } from "../../workspace/types.js";
import {
  mapWithConcurrency,
  resolveSafePath,
  withWorkspaceLock,
  writeJson,
} from "../../utils/fs.js";
import { getRepositoryReferenceBranch } from "../../workspace/repositories.js";
import { workspaceStateDirName } from "../../workspace/state-directory.js";
import type { CommandContext } from "../command-context.js";
import { createLoopProgressReporter } from "./execution.js";
import { errorMessage, escalateStatus, MaestroError } from "../errors.js";
import { resolveWorkspace } from "../workspace-service.js";

const GIT_COMMAND_CONCURRENCY_LIMIT = 4;

export async function checkoutWorkspaceGitBranches(
  workspaceRoot: string,
  context: CommandContext,
): Promise<WorkspaceGitReport> {
  return runWorkspaceGitCommand(workspaceRoot, "checkout", context);
}

export async function pullWorkspaceGitBranches(
  workspaceRoot: string,
  context: CommandContext,
): Promise<WorkspaceGitReport> {
  return runWorkspaceGitCommand(workspaceRoot, "pull", context);
}

export async function syncWorkspaceGitBranches(
  workspaceRoot: string,
  context: CommandContext,
): Promise<WorkspaceGitReport> {
  return runWorkspaceGitCommand(workspaceRoot, "sync", context);
}

async function runWorkspaceGitCommand(
  workspaceRoot: string,
  command: WorkspaceGitReport["command"],
  context: CommandContext,
): Promise<WorkspaceGitReport> {
  const report: WorkspaceGitReport = {
    status: "ok",
    workspace: path.basename(workspaceRoot),
    command,
    repositories: [],
    issues: [],
  };

  try {
    const resolvedWorkspace = await resolveWorkspace(workspaceRoot);
    report.workspace = resolvedWorkspace.manifest.metadata.name;
    const progress = createLoopProgressReporter(
      context.stderr,
      `git ${command}`,
      resolvedWorkspace.repositories.length,
    );

    const repositoryResults = await mapWithConcurrency(
      resolvedWorkspace.repositories,
      GIT_COMMAND_CONCURRENCY_LIMIT,
      async (repository, index) => {
        progress.itemStarted(repository.name, index);
        const result = await runRepositoryGitCommand(workspaceRoot, repository, command, context);
        progress.itemCompleted();
        return result;
      },
    );
    progress.complete();

    for (const repositoryResult of repositoryResults) {
      report.repositories.push(repositoryResult.repository);
      if (repositoryResult.issue) {
        report.status = escalateStatus(report.status, "warning");
        report.issues.push(repositoryResult.issue);
      }
    }
  } catch (error) {
    report.status = "error";
    const maestroError = new MaestroError({
      code: "WORKSPACE_GIT_COMMAND_FAILED",
      message: `Workspace git ${command} failed`,
      cause: error,
    });
    report.issues.push({
      code: "WORKSPACE_GIT_COMMAND_FAILED",
      message: errorMessage(maestroError),
    });
  }

  await withWorkspaceLock(workspaceRoot, async () => {
    const reportPath = resolveSafePath(
      workspaceRoot,
      path.join(workspaceStateDirName, "reports", `git-${command}-report.json`),
      "workspace git report path",
    );
    await writeJson(reportPath, report);
  });

  return report;
}

async function runRepositoryGitCommand(
  workspaceRoot: string,
  repository: RepositoryRef,
  command: WorkspaceGitReport["command"],
  context: CommandContext,
): Promise<{
  repository: WorkspaceGitReport["repositories"][number];
  issue?: WorkspaceGitReport["issues"][number];
}> {
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
    const result =
      command === "checkout"
        ? await context.gitAdapter.checkoutBranch(
            repoRoot,
            getRepositoryReferenceBranch(repository),
          )
        : command === "pull"
          ? await context.gitAdapter.pullCurrentBranch(repoRoot)
          : await syncWorkspaceGitRepository(repoRoot, repository, context);

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
