import path from "node:path";
import type { InstallReport } from "../../report/types.js";
import { getWorkspaceStateRoot } from "../../workspace/state-directory.js";
import { pathExists, resolveSafePath, withWorkspaceLock, writeJson } from "../../utils/fs.js";
import type { GitCommandAdapter } from "../command-context.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";

export async function persistWorkspaceInstallState(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    return;
  }

  await withWorkspaceLock(workspaceRoot, async () => {
    await writeJson(getWorkspaceStateRoot(workspaceRoot, "state.json"), {
      installedAt: new Date().toISOString(),
      workspace: resolvedWorkspace.manifest.metadata.name,
      runtimes: Object.keys(resolvedWorkspace.runtimes),
    });
  });
}

export function resolveInstallReportPath(workspaceRoot: string, reportName: string): string {
  const reportsRoot = getWorkspaceStateRoot(workspaceRoot, "reports");
  return resolveSafePath(reportsRoot, reportName, "install report path");
}

export async function persistInstallReport(
  workspaceRoot: string,
  reportPath: string,
  report: InstallReport,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) {
    return;
  }

  await withWorkspaceLock(workspaceRoot, async () => {
    await writeJson(reportPath, report);
  });
}

export async function commitInitialWorkspaceSnapshot(
  workspaceRoot: string,
  gitAdapter: Pick<GitCommandAdapter, "commitAll" | "isUnbornRepository">,
  dryRun: boolean,
): Promise<void> {
  if (
    !dryRun &&
    (await pathExists(path.join(workspaceRoot, ".gitignore"))) &&
    (await gitAdapter.isUnbornRepository(workspaceRoot))
  ) {
    await gitAdapter.commitAll(workspaceRoot, "🪄 booted by Maestro");
  }
}
