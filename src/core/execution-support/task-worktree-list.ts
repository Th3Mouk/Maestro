import type { WorktreeListReport } from "../../report/types.js";
import { pathExists } from "../../utils/fs.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import {
  evaluateTaskPrunability,
  type CheckoutStateGitAdapter,
} from "../execution/checkout-state.js";
import type { ForgeClient, ForgeName } from "../../adapters/forge/github-forge.js";
import { escalateStatus } from "../errors.js";
import { resolveForge } from "../execution/forge-integration.js";
import {
  applyForgeToTaskCheckouts,
  inspectTaskWorktrees,
  listTaskWorktreeEntries,
} from "./task-worktree-inventory.js";
import { getTaskWorktreesRoot } from "./worktree-root.js";

const FORGE_CONCURRENCY_LIMIT = 4;

type ListGitAdapter = CheckoutStateGitAdapter & {
  getRemoteUrl: (repoRoot: string) => Promise<string>;
  readUpstreamBranch: (repoRoot: string, branchName: string) => Promise<string | undefined>;
};

export async function listTaskWorktreesWithResolvedWorkspace(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  options: { forge?: ForgeName | "none"; status?: boolean } = {},
  context?: {
    forgeClients?: Partial<Record<ForgeName, ForgeClient>>;
    gitAdapter: ListGitAdapter;
  },
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

  const { entries, foreign } = await listTaskWorktreeEntries(worktreesRoot);
  if (foreign.length > 0) {
    report.foreign = foreign;
  }
  for (const entry of entries) {
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
    const forge = resolveForge(options.forge, resolvedWorkspace);
    const client = forge ? context.forgeClients?.[forge] : undefined;
    if (forge && client) {
      const issue = await applyForgeToTaskCheckouts(checkouts, {
        client,
        concurrencyLimit: FORGE_CONCURRENCY_LIMIT,
        forge,
        gitAdapter: context.gitAdapter,
      });
      if (issue) {
        report.status = escalateStatus(report.status, "warning");
        report.issues.push(issue);
      }
    }
    report.worktrees.forEach((worktree, index) => {
      worktree.checkouts = checkouts[index];
      worktree.prunable = evaluateTaskPrunability(checkouts[index], {
        includeGone: false,
      }).prunable;
    });
  }

  return report;
}
