import path from "node:path";
import type { RepoListReport } from "../../report/types.js";
import { pathExists, resolveSafePath } from "../../utils/fs.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";

export async function listWorkspaceRepositoriesWithResolvedWorkspace(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
): Promise<RepoListReport> {
  const report: RepoListReport = {
    status: "ok",
    workspace: resolvedWorkspace.manifest.metadata.name,
    repositories: [],
    issues: [],
  };

  for (const repository of resolvedWorkspace.repositories) {
    const repoPath = resolveSafePath(
      workspaceRoot,
      path.join("repos", repository.name),
      "workspace repository path",
    );
    const installed = await pathExists(path.join(repoPath, ".git"));
    report.repositories.push({
      name: repository.name,
      branch: repository.branch ?? "main",
      remote: repository.remote,
      path: repoPath,
      installed,
    });
  }

  return report;
}
