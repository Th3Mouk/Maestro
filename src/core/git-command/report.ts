import path from "node:path";
import type { WorkspaceGitReport } from "../../report/types.js";
import { appendReportIssue } from "../reporting/issues.js";
import { resolveSafePath, withWorkspaceLock, writeJson } from "../../utils/fs.js";
import { workspaceStateDirName } from "../../workspace/state-directory.js";
import type { RepositoryCommandResult, WorkspaceGitCommand } from "./contracts.js";

export function createWorkspaceGitReport(
  workspaceRoot: string,
  command: WorkspaceGitCommand,
): WorkspaceGitReport {
  return {
    status: "ok",
    workspace: path.basename(workspaceRoot),
    command,
    repositories: [],
    issues: [],
  };
}

export function appendRepositoryCommandResult(
  report: WorkspaceGitReport,
  result: RepositoryCommandResult,
): void {
  report.repositories.push(result.repository);
  if (!result.issue) {
    return;
  }

  appendReportIssue(report, result.issue, "warning");
}

export async function persistWorkspaceGitReport(
  workspaceRoot: string,
  command: WorkspaceGitCommand,
  report: WorkspaceGitReport,
): Promise<void> {
  await withWorkspaceLock(workspaceRoot, async () => {
    const reportPath = resolveSafePath(
      workspaceRoot,
      path.join(workspaceStateDirName, "reports", `git-${command}-report.json`),
      "workspace git report path",
    );
    await writeJson(reportPath, report);
  });
}
