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
import { runListColumns } from "../execution/list-columns.js";
import {
  applyForgeToTaskCheckouts,
  inspectTaskWorktrees,
  listTaskWorktreeEntries,
  type TaskWorktreeEntry,
} from "./task-worktree-inventory.js";
import { mainWorkspaceTaskName } from "./task-worktree-rows.js";
import { getTaskWorktreesRoot } from "./worktree-root.js";

const FORGE_CONCURRENCY_LIMIT = 4;

export interface TaskWorktreeListOptions {
  /** Cut-off for each `listColumns` command; 5 s by default. */
  columnTimeoutMs?: number;
  forge?: ForgeName | "none";
  status?: boolean;
}

export type TaskWorktreeListGitAdapter = CheckoutStateGitAdapter & {
  getRemoteUrl: (repoRoot: string) => Promise<string>;
  readUpstreamBranch: (repoRoot: string, branchName: string) => Promise<string | undefined>;
};

export async function listTaskWorktreesWithResolvedWorkspace(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  options: TaskWorktreeListOptions = {},
  context?: {
    forgeClients?: Partial<Record<ForgeName, ForgeClient>>;
    gitAdapter: TaskWorktreeListGitAdapter;
  },
): Promise<WorktreeListReport> {
  const worktreesRoot = getTaskWorktreesRoot(workspaceRoot, resolvedWorkspace);
  const report: WorktreeListReport = {
    status: "ok",
    workspace: resolvedWorkspace.manifest.metadata.name,
    worktrees: [],
    issues: [],
  };

  const { entries, foreign } = (await pathExists(worktreesRoot))
    ? await listTaskWorktreeEntries(worktreesRoot)
    : { entries: [], foreign: [] };
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

  if (!options.status || !context) {
    return report;
  }

  // The main workspace is inspected like a task whose checkouts are the primary clones.
  const mainWorkspace: TaskWorktreeEntry = {
    createdAt: "",
    directoryName: "",
    metadata: {},
    name: mainWorkspaceTaskName,
    repositories: resolvedWorkspace.repositories.map((repository) => repository.name),
    root: workspaceRoot,
  };
  const [rootCheckouts = [], ...checkouts] = await inspectTaskWorktrees(
    [mainWorkspace, ...entries],
    { gitAdapter: context.gitAdapter, resolvedWorkspace, workspaceRoot },
  );
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
  report.root = { checkouts: rootCheckouts };
  report.worktrees.forEach((worktree, index) => {
    worktree.checkouts = checkouts[index];
    worktree.prunable = evaluateTaskPrunability(checkouts[index] ?? [], {
      includeGone: false,
    }).prunable;
  });

  const listColumns = resolvedWorkspace.execution.worktrees?.listColumns ?? [];
  if (listColumns.length > 0) {
    const { issues, values } = await runListColumns(listColumns, {
      taskNames: [mainWorkspaceTaskName, ...report.worktrees.map((worktree) => worktree.name)],
      timeoutMs: options.columnTimeoutMs,
      workspaceRoot,
    });
    if (issues.length > 0) {
      report.status = escalateStatus(report.status, "warning");
      report.issues.push(...issues);
    }
    report.root.columns = values.get(mainWorkspaceTaskName);
    for (const worktree of report.worktrees) {
      worktree.columns = values.get(worktree.name);
    }
  }

  return report;
}
