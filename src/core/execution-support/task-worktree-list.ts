import type { WorktreeListReport } from "../../report/types.js";
import { pathExists } from "../../utils/fs.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import { escalateStatus } from "../errors.js";
import {
  evaluateTaskPrunability,
  type CheckoutStateGitAdapter,
} from "../execution/checkout-state.js";
import { getTaskWorktreeMetadataPath } from "../execution/task-worktree-metadata.js";
import { inspectTaskWorktrees, listTaskWorktreeEntries } from "./task-worktree-inventory.js";
import { getTaskWorktreesRoot } from "./worktree-root.js";

export async function listTaskWorktreesWithResolvedWorkspace(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  options: { status?: boolean } = {},
  context?: { gitAdapter: CheckoutStateGitAdapter },
): Promise<WorktreeListReport> {
  const worktreesRoot = getTaskWorktreesRoot(workspaceRoot, resolvedWorkspace);
  const report: WorktreeListReport = {
    status: "ok",
    workspace: resolvedWorkspace.manifest.metadata.name,
    worktrees: [],
    issues: [],
  };

  if (!(await pathExists(worktreesRoot))) {
    return report;
  }

  const entries = await listTaskWorktreeEntries(worktreesRoot);
  for (const entry of entries) {
    if (!entry.metadata) {
      report.status = escalateStatus(report.status, "warning");
      report.issues.push({
        code: "WORKTREE_METADATA_MISSING",
        message: `No metadata found for worktree "${entry.directoryName}".`,
        path: getTaskWorktreeMetadataPath(entry.root),
      });
    }
    report.worktrees.push({
      name: entry.name,
      root: entry.root,
      createdAt: entry.createdAt,
      repositories: entry.repositories,
    });
  }

  if (options.status && context) {
    const checkouts = await inspectTaskWorktrees(entries, {
      gitAdapter: context.gitAdapter,
      resolvedWorkspace,
      workspaceRoot,
    });
    report.worktrees.forEach((worktree, index) => {
      worktree.checkouts = checkouts[index];
      worktree.prunable = evaluateTaskPrunability(checkouts[index], {
        includeGone: false,
      }).prunable;
    });
  }

  return report;
}
