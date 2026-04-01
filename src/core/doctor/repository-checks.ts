import path from "node:path";
import type { DoctorReport } from "../../report/types.js";
import { resolveSafePath } from "../../utils/fs.js";
import {
  getRepositoryReferenceBranch,
  getRepositorySparseExcludePaths,
  getRepositorySparseIncludePaths,
} from "../../workspace/repositories.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import type { CommandContext } from "../command-context.js";
import { discoverSparsePaths } from "../workspace-service.js";
import { pushDoctorWarning } from "./reporting.js";

function normalizeSparsePath(value: string): string {
  return value.endsWith("/") ? value : value.replace(/\/+$/, "");
}

function isSparsePathPresent(visibleEntries: string[], expectedPath: string): boolean {
  const normalized = normalizeSparsePath(expectedPath);
  return visibleEntries.some(
    (entry) => entry === expectedPath || entry === normalized || entry.startsWith(normalized),
  );
}

export async function runRepositoryChecks(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  context: CommandContext,
  report: DoctorReport,
): Promise<void> {
  for (const repository of resolvedWorkspace.repositories) {
    const repoRoot = resolveSafePath(
      workspaceRoot,
      path.join("repos", repository.name),
      "repository root",
    );
    if (!(await context.gitAdapter.hasGitMetadata(repoRoot))) {
      pushDoctorWarning(report, {
        code: "REPO_MISSING",
        message: `Repository not installed: ${repository.name}`,
        path: repoRoot,
      });
      continue;
    }

    const remote = await context.gitAdapter.getRemoteUrl(repoRoot);
    if (remote !== repository.remote) {
      pushDoctorWarning(report, {
        code: "REMOTE_MISMATCH",
        message: `Remote differs for ${repository.name}`,
        path: repoRoot,
      });
    }

    const branch = await context.gitAdapter.getCurrentBranch(repoRoot);
    const referenceBranch = getRepositoryReferenceBranch(repository);
    if (branch !== referenceBranch) {
      pushDoctorWarning(report, {
        code: "BRANCH_MISMATCH",
        message: `Active branch is ${branch} instead of reference branch ${referenceBranch}`,
        path: repoRoot,
      });
    }

    const visibleEntries = await discoverSparsePaths(repoRoot);
    const includePaths = getRepositorySparseIncludePaths(repository);
    const excludePaths = getRepositorySparseExcludePaths(repository);

    for (const visiblePath of includePaths) {
      if (!isSparsePathPresent(visibleEntries, visiblePath)) {
        pushDoctorWarning(report, {
          code: "SPARSE_PATH_MISSING",
          message: `Sparse path is missing: ${visiblePath}`,
          path: repoRoot,
        });
      }
    }

    for (const excludedPath of excludePaths) {
      if (isSparsePathPresent(visibleEntries, excludedPath)) {
        pushDoctorWarning(report, {
          code: "SPARSE_PATH_PRESENT",
          message: `Sparse exclusion is still present: ${excludedPath}`,
          path: repoRoot,
        });
      }
    }
  }
}
