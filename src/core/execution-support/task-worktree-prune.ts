import path from "node:path";
import type { TaskCheckoutState, WorktreePruneReport } from "../../report/types.js";
import { mapWithConcurrency, pathExists, resolveSafePath } from "../../utils/fs.js";
import { getRepositoryReferenceBranch } from "../../workspace/repositories.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import { errorMessage, escalateStatus } from "../errors.js";
import {
  describeUnprunableWork,
  evaluateTaskPrunability,
  resolveCheckoutReferenceRef,
  type CheckoutStateGitAdapter,
} from "../execution/checkout-state.js";
import { createTaskBranchName, sanitizeSegment } from "../execution/task-worktree.js";
import type { TaskWorktreeRemoveGitAdapter } from "../execution/task-worktree-removal.js";
import {
  inspectTaskWorktrees,
  listTaskWorktreeEntries,
  type TaskWorktreeEntry,
} from "./task-worktree-inventory.js";
import { removeTaskWorktreeWithResolvedWorkspace } from "./task-worktree-remove.js";
import { getTaskWorktreesRoot } from "./worktree-root.js";

type PruneGitAdapter = CheckoutStateGitAdapter &
  TaskWorktreeRemoveGitAdapter & {
    deleteBranch: (repoRoot: string, branchName: string) => Promise<void>;
    fetch: (repoRoot: string) => Promise<void>;
    listTaskBranches: (
      repoRoot: string,
      prefix: string,
    ) => Promise<Array<{ branch: string; checkedOut: boolean }>>;
  };

export interface PruneOptions {
  /** Also delete orphan task branches that no task worktree holds. */
  branches?: boolean;
  dryRun?: boolean;
  /** `false` skips `git fetch --prune`. */
  fetch?: boolean;
  /** Also treat a clean branch whose upstream is gone as landed. */
  includeGone?: boolean;
}

/** The workspace root or a managed repository: where task branches live. */
interface BranchSource {
  name: string;
  referenceBranch?: string;
  root: string;
}

interface PruneContext {
  concurrencyLimit: number;
  gitAdapter: PruneGitAdapter;
  options: PruneOptions;
  report: WorktreePruneReport;
  resolvedWorkspace: ResolvedWorkspace;
  workspaceRoot: string;
}

export async function pruneTaskWorktreesWithResolvedWorkspace(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  options: PruneOptions,
  context: { gitAdapter: PruneGitAdapter },
  concurrencyLimit: number,
): Promise<WorktreePruneReport> {
  const prune: PruneContext = {
    concurrencyLimit,
    gitAdapter: context.gitAdapter,
    options,
    report: {
      status: "ok",
      workspace: resolvedWorkspace.manifest.metadata.name,
      dryRun: options.dryRun ?? false,
      removed: [],
      deletedBranches: [],
      kept: [],
      issues: [],
    },
    resolvedWorkspace,
    workspaceRoot,
  };

  const sources = await listBranchSources(prune);
  if (options.fetch !== false) {
    await fetchSources(prune, sources);
  }

  const worktreesRoot = getTaskWorktreesRoot(workspaceRoot, resolvedWorkspace);
  const entries = (await pathExists(worktreesRoot))
    ? await listTaskWorktreeEntries(worktreesRoot)
    : [];
  const checkouts = await inspectTaskWorktrees(entries, {
    gitAdapter: context.gitAdapter,
    resolvedWorkspace,
    workspaceRoot,
  });

  const keptTaskDirectories = new Set<string>();
  for (const [index, entry] of entries.entries()) {
    const pruned = await pruneTask(prune, entry, checkouts[index]);
    if (!pruned) {
      keptTaskDirectories.add(entry.directoryName);
    }
  }

  if (options.branches) {
    for (const source of sources) {
      await pruneOrphanBranches(prune, source, keptTaskDirectories);
    }
  }

  return prune.report;
}

async function listBranchSources(prune: PruneContext): Promise<BranchSource[]> {
  const candidates: BranchSource[] = [
    { name: prune.resolvedWorkspace.manifest.metadata.name, root: prune.workspaceRoot },
    ...prune.resolvedWorkspace.repositories.map((repository) => ({
      name: repository.name,
      referenceBranch: getRepositoryReferenceBranch(repository),
      root: resolveSafePath(
        prune.workspaceRoot,
        path.join("repos", repository.name),
        "workspace repository path",
      ),
    })),
  ];
  const installed = await Promise.all(
    candidates.map((source) => prune.gitAdapter.hasGitMetadata(source.root)),
  );
  return candidates.filter((_, index) => installed[index]);
}

async function fetchSources(prune: PruneContext, sources: BranchSource[]): Promise<void> {
  await mapWithConcurrency(sources, prune.concurrencyLimit, async (source) => {
    try {
      await prune.gitAdapter.fetch(source.root);
    } catch (error) {
      prune.report.status = escalateStatus(prune.report.status, "warning");
      prune.report.issues.push({
        code: "FETCH_FAILED",
        message: `Could not fetch ${source.name}; its remote-tracking branches may be stale: ${errorMessage(error)}`,
        path: source.root,
      });
    }
  });
}

/** Removes a prunable task and its task branches. Returns whether the task is gone. */
async function pruneTask(
  prune: PruneContext,
  entry: TaskWorktreeEntry,
  checkouts: TaskCheckoutState[],
): Promise<boolean> {
  const { report } = prune;
  const verdict = evaluateTaskPrunability(checkouts, {
    includeGone: prune.options.includeGone ?? false,
  });
  if (!verdict.prunable) {
    report.kept.push({ name: entry.name, reasons: verdict.reasons });
    return false;
  }

  const branches = listVerifiedTaskBranches(prune, entry, checkouts);
  if (prune.options.dryRun) {
    report.removed.push(entry.name);
    report.deletedBranches.push(...branches.map(({ name, branch }) => ({ name, branch })));
    return true;
  }

  const removal = await removeTaskWorktreeWithResolvedWorkspace(
    prune.workspaceRoot,
    prune.resolvedWorkspace,
    entry.directoryName,
    {},
    { gitAdapter: prune.gitAdapter },
    prune.concurrencyLimit,
  );
  if (removal.status !== "ok") {
    report.status = escalateStatus(report.status, "warning");
    report.issues.push(...removal.issues);
    report.kept.push({
      name: entry.name,
      reasons: removal.issues.map((issue) => `remove failed: ${issue.message}`),
    });
    return false;
  }

  report.removed.push(entry.name);
  for (const branch of branches) {
    await deleteBranch(prune, branch);
  }
  return true;
}

/**
 * The task branches whose state was just verified: those the task's checkouts had checked out.
 * A checkout switched to another branch keeps that branch; it is never deleted here.
 */
function listVerifiedTaskBranches(
  prune: PruneContext,
  entry: TaskWorktreeEntry,
  checkouts: TaskCheckoutState[],
): Array<{ branch: string; name: string; root: string }> {
  const branchPrefix = prune.resolvedWorkspace.execution.worktrees?.branchPrefix;
  const workspaceName = prune.resolvedWorkspace.manifest.metadata.name;
  return checkouts.flatMap((checkout) => {
    const isWorkspaceRoot = checkout.path === entry.root;
    const expected = createTaskBranchName(branchPrefix, entry.directoryName, checkout.name);
    if (checkout.branch !== expected) {
      return [];
    }
    const root = isWorkspaceRoot
      ? prune.workspaceRoot
      : resolveSafePath(
          prune.workspaceRoot,
          path.join("repos", checkout.name),
          "workspace repository path",
        );
    return [{ branch: expected, name: isWorkspaceRoot ? workspaceName : checkout.name, root }];
  });
}

async function deleteBranch(
  prune: PruneContext,
  target: { branch: string; name: string; root: string },
): Promise<void> {
  try {
    await prune.gitAdapter.deleteBranch(target.root, target.branch);
    prune.report.deletedBranches.push({ name: target.name, branch: target.branch });
  } catch (error) {
    prune.report.status = escalateStatus(prune.report.status, "warning");
    prune.report.issues.push({
      code: "BRANCH_DELETE_FAILED",
      message: `Could not delete ${target.branch} in ${target.name}: ${errorMessage(error)}`,
      path: target.root,
    });
  }
}

/**
 * Deletes task branches that no worktree has checked out and whose task is gone, when their
 * work is integrated (or, with `--include-gone`, their upstream is gone). The others are kept
 * and listed.
 */
async function pruneOrphanBranches(
  prune: PruneContext,
  source: BranchSource,
  keptTaskDirectories: Set<string>,
): Promise<void> {
  const prefix = sanitizeSegment(
    prune.resolvedWorkspace.execution.worktrees?.branchPrefix ?? "task",
  );
  const orphans = (await prune.gitAdapter.listTaskBranches(source.root, prefix)).filter(
    ({ branch, checkedOut }) => !checkedOut && !keptTaskDirectories.has(branch.split("/")[1]),
  );
  if (orphans.length === 0) {
    return;
  }

  const referenceRef = await resolveCheckoutReferenceRef(prune.gitAdapter, {
    referenceBranch: source.referenceBranch,
    sourceRoot: source.root,
  });
  for (const { branch } of orphans) {
    const state = await prune.gitAdapter.inspectRef(source.root, referenceRef, branch);
    const reason = describeUnprunableWork({ ...state, dirty: false }, source.name, {
      includeGone: prune.options.includeGone ?? false,
    });
    if (reason) {
      prune.report.kept.push({ name: branch, reasons: [reason] });
    } else if (prune.options.dryRun) {
      prune.report.deletedBranches.push({ name: source.name, branch });
    } else {
      await deleteBranch(prune, { branch, name: source.name, root: source.root });
    }
  }
}
