import type { WorkspaceGitReport } from "../../report/types.js";
import { mapWithConcurrency } from "../../utils/fs.js";
import type { CommandContext } from "../command-context.js";
import { errorMessage, MaestroError } from "../errors.js";
import { appendReportError } from "../reporting/issues.js";
import { resolveWorkspace } from "../workspace-service.js";
import { createLoopProgressReporter } from "../commands/execution.js";
import type { RepositoryCommandResult, WorkspaceGitCommand } from "./contracts.js";
import {
  appendRepositoryCommandResult,
  createWorkspaceGitReport,
  persistWorkspaceGitReport,
} from "./report.js";
import { runRepositoryGitOperation } from "./repository-operation.js";

const GIT_COMMAND_CONCURRENCY_LIMIT = 4;

export async function runWorkspaceGitCommand(
  workspaceRoot: string,
  command: WorkspaceGitCommand,
  context: CommandContext,
): Promise<WorkspaceGitReport> {
  const report = createWorkspaceGitReport(workspaceRoot, command);

  try {
    const repositoryResults = await executeWorkspaceGitCommand(
      workspaceRoot,
      command,
      context,
      report,
    );
    appendRepositoryResultsToReport(report, repositoryResults);
  } catch (error) {
    appendWorkspaceGitCommandFailure(report, command, error);
  }

  await persistWorkspaceGitReport(workspaceRoot, command, report);
  return report;
}

async function executeWorkspaceGitCommand(
  workspaceRoot: string,
  command: WorkspaceGitCommand,
  context: CommandContext,
  report: WorkspaceGitReport,
): Promise<RepositoryCommandResult[]> {
  const resolvedWorkspace = await resolveWorkspace(workspaceRoot);
  report.workspace = resolvedWorkspace.manifest.metadata.name;
  const progress = createLoopProgressReporter(
    context.stderr,
    `git ${command}`,
    resolvedWorkspace.repositories.length,
  );

  try {
    return await mapWithConcurrency(
      resolvedWorkspace.repositories,
      GIT_COMMAND_CONCURRENCY_LIMIT,
      async (repository, index) => {
        progress.itemStarted(repository.name, index);
        try {
          return await runRepositoryGitOperation(workspaceRoot, repository, command, context);
        } finally {
          progress.itemCompleted();
        }
      },
    );
  } finally {
    progress.complete();
  }
}

function appendRepositoryResultsToReport(
  report: WorkspaceGitReport,
  repositoryResults: RepositoryCommandResult[],
): void {
  for (const result of repositoryResults) {
    appendRepositoryCommandResult(report, result);
  }
}

function appendWorkspaceGitCommandFailure(
  report: WorkspaceGitReport,
  command: WorkspaceGitCommand,
  error: unknown,
): void {
  const maestroError = new MaestroError({
    code: "WORKSPACE_GIT_COMMAND_FAILED",
    message: `Workspace git ${command} failed`,
    cause: error,
  });

  appendReportError(report, {
    code: "WORKSPACE_GIT_COMMAND_FAILED",
    message: errorMessage(maestroError),
  });
}
