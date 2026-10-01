import path from "node:path";
import type { TaskCheckoutState } from "../../report/types.js";
import type { RepositoryRef } from "../../workspace/types.js";
import { pathExists, resolveSafePath } from "../../utils/fs.js";
import { getRepositoryReferenceBranch } from "../../workspace/repositories.js";
import { errorMessage } from "../errors.js";
import {
  excludeGeneratedChanges,
  type GeneratedFileFingerprints,
} from "./task-worktree-generated-files.js";

export type CheckoutStateGitAdapter = {
  hasGitMetadata: (repoRoot: string) => Promise<boolean>;
  inspectRef: (
    repoRoot: string,
    referenceRef: string,
    tip?: string,
  ) => Promise<Pick<TaskCheckoutState, "branch" | "integrated" | "localOnly" | "upstream">>;
  listUncommittedChanges: (repoRoot: string) => Promise<string[]>;
  remoteBranchExists: (repoRoot: string, branchName: string) => Promise<boolean>;
  resolveDefaultBranchRef: (repoRoot: string) => Promise<string>;
};

/** One checkout of a task, and what to compare it with. */
interface TaskCheckoutTarget {
  generatedFiles?: GeneratedFileFingerprints;
  name: string;
  path: string;
  /** The reference branch, or `undefined` for the workspace's default branch. */
  referenceBranch?: string;
  /** The primary checkout this worktree belongs to. */
  sourceRoot: string;
}

export function listTaskCheckoutTargets(options: {
  generatedFiles?: GeneratedFileFingerprints;
  repositories: RepositoryRef[];
  repositoryNames: string[];
  taskRoot: string;
  workspaceName: string;
  workspaceRoot: string;
}): TaskCheckoutTarget[] {
  return [
    {
      generatedFiles: options.generatedFiles,
      name: options.workspaceName,
      path: options.taskRoot,
      sourceRoot: options.workspaceRoot,
    },
    ...options.repositoryNames.map((name) => {
      const repository = options.repositories.find((candidate) => candidate.name === name);
      return {
        name,
        path: resolveSafePath(options.taskRoot, path.join("repos", name), "task repository path"),
        referenceBranch: repository ? getRepositoryReferenceBranch(repository) : undefined,
        sourceRoot: resolveSafePath(
          options.workspaceRoot,
          path.join("repos", name),
          "workspace repository path",
        ),
      };
    }),
  ];
}

/**
 * Computes the state of a checkout. Returns `undefined` for a checkout whose directory is
 * gone, since there is nothing left in it to lose.
 */
export async function computeCheckoutState(
  gitAdapter: CheckoutStateGitAdapter,
  target: TaskCheckoutTarget,
): Promise<TaskCheckoutState | undefined> {
  const unknown: TaskCheckoutState = {
    name: target.name,
    path: target.path,
    branch: null,
    dirty: false,
    localOnly: 0,
    upstream: "none",
    integrated: false,
  };

  if (!(await gitAdapter.hasGitMetadata(target.path))) {
    if (!(await pathExists(target.path))) {
      return undefined;
    }
    return { ...unknown, error: "not a Git worktree" };
  }

  try {
    const [changes, referenceRef] = await Promise.all([
      gitAdapter.listUncommittedChanges(target.path),
      resolveCheckoutReferenceRef(gitAdapter, target),
    ]);
    const userChanges = await excludeGeneratedChanges(target.path, changes, target.generatedFiles);
    const refState = await gitAdapter.inspectRef(target.path, referenceRef);
    return { ...unknown, ...refState, dirty: userChanges.length > 0 };
  } catch (error) {
    return { ...unknown, error: errorMessage(error) };
  }
}

/**
 * `origin/<reference>` when it exists, else the local reference branch; the workspace's
 * default branch when there is no reference branch (the workspace root).
 */
export async function resolveCheckoutReferenceRef(
  gitAdapter: Pick<CheckoutStateGitAdapter, "remoteBranchExists" | "resolveDefaultBranchRef">,
  target: Pick<TaskCheckoutTarget, "referenceBranch" | "sourceRoot">,
): Promise<string> {
  if (!target.referenceBranch) {
    return gitAdapter.resolveDefaultBranchRef(target.sourceRoot);
  }
  return (await gitAdapter.remoteBranchExists(target.sourceRoot, target.referenceBranch))
    ? `origin/${target.referenceBranch}`
    : target.referenceBranch;
}

/**
 * Whether a branch's work is safe to drop: clean, and either fully on a remote or integrated
 * in the reference branch. With `includeGone`, a deleted upstream also counts, which covers
 * squash merges the patch comparison misses (after conflict resolution, for example).
 */
export function describeUnprunableWork(
  state: Pick<TaskCheckoutState, "dirty" | "error" | "integrated" | "localOnly" | "upstream">,
  name: string,
  options: { includeGone: boolean },
): string | undefined {
  if (state.error) {
    return `cannot inspect ${name}: ${state.error}`;
  }
  if (state.dirty) {
    return `dirty: ${name}`;
  }
  if (state.localOnly === 0 || state.integrated) {
    return undefined;
  }
  if (state.upstream === "gone") {
    if (options.includeGone) {
      return undefined;
    }
    return `${describeCommits(state.localOnly)} in ${name} (upstream gone; --include-gone prunes it)`;
  }
  return `${describeCommits(state.localOnly)} in ${name}`;
}

export function evaluateTaskPrunability(
  checkouts: TaskCheckoutState[],
  options: { includeGone: boolean },
): { prunable: boolean; reasons: string[] } {
  const reasons = checkouts
    .map((checkout) => describeUnprunableWork(checkout, checkout.name, options))
    .filter((reason): reason is string => reason !== undefined);
  return { prunable: reasons.length === 0, reasons };
}

function describeCommits(count: number): string {
  return `${count} local-only commit${count === 1 ? "" : "s"}`;
}
