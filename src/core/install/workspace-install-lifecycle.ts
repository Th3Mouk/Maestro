import { getWorkspaceStateRoot } from "../../workspace/state-directory.js";
import { withWorkspaceLock, writeJson } from "../../utils/fs.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import type { InstallReport } from "../../report/types.js";
import type { GitCommandAdapter } from "../command-context.js";
import { ensureWorkspaceSkeleton } from "../workspace-service.js";
import { ensureWorkspaceGitignore } from "../workspace-gitignore.js";
import {
  commitInitialWorkspaceSnapshot,
  persistInstallReport,
  persistWorkspaceInstallState,
  resolveInstallReportPath,
} from "./state-report-persistence.js";

export async function initializeWorkspaceInstall(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  dryRun: boolean,
  gitAdapter: Pick<GitCommandAdapter, "ensureWorkspaceRepository">,
): Promise<void> {
  await gitAdapter.ensureWorkspaceRepository(workspaceRoot, dryRun);
  if (dryRun) {
    return;
  }

  await ensureWorkspaceSkeleton(workspaceRoot, resolvedWorkspace.manifest);
  await ensureWorkspaceGitignore(workspaceRoot);
  await withWorkspaceLock(workspaceRoot, async () => {
    await writeJson(getWorkspaceStateRoot(workspaceRoot, "lock.json"), resolvedWorkspace.lockfile);
  });
}

export async function finalizeWorkspaceInstall(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  report: InstallReport,
  reportName: string,
  dryRun: boolean,
  gitAdapter: Pick<GitCommandAdapter, "commitAll" | "isUnbornRepository">,
): Promise<void> {
  await persistWorkspaceInstallState(workspaceRoot, resolvedWorkspace, dryRun);
  const reportPath = resolveInstallReportPath(workspaceRoot, reportName);
  await persistInstallReport(workspaceRoot, reportPath, report, dryRun);
  await commitInitialWorkspaceSnapshot(workspaceRoot, gitAdapter, dryRun);
}
