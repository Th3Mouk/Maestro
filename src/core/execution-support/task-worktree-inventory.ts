import path from "node:path";
import type { TaskCheckoutState } from "../../report/types.js";
import { listDirectories, mapWithConcurrency } from "../../utils/fs.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import {
  computeCheckoutState,
  listTaskCheckoutTargets,
  type CheckoutStateGitAdapter,
} from "../execution/checkout-state.js";
import {
  listTaskRepositoryNames,
  readTaskWorktreeMetadata,
  type TaskWorktreeMetadata,
} from "../execution/task-worktree-metadata.js";

export interface TaskWorktreeEntry {
  createdAt: string;
  /** The task directory name, which `remove` and branch names are derived from. */
  directoryName: string;
  metadata?: Partial<TaskWorktreeMetadata>;
  name: string;
  repositories: string[];
  root: string;
}

const CHECKOUT_STATE_CONCURRENCY_LIMIT = 8;

export async function listTaskWorktreeEntries(worktreesRoot: string): Promise<TaskWorktreeEntry[]> {
  const directoryNames = await listDirectories(worktreesRoot);
  return Promise.all(
    directoryNames.map(async (directoryName) => {
      const root = path.join(worktreesRoot, directoryName);
      const metadata = await readTaskWorktreeMetadata(root);
      return {
        createdAt: metadata?.createdAt ?? "",
        directoryName,
        metadata,
        name: metadata?.name ?? directoryName,
        repositories: await listTaskRepositoryNames(root, metadata),
        root,
      };
    }),
  );
}

/** Checkout states per task, the workspace root first; computed concurrently across tasks. */
export async function inspectTaskWorktrees(
  entries: TaskWorktreeEntry[],
  options: {
    gitAdapter: CheckoutStateGitAdapter;
    resolvedWorkspace: ResolvedWorkspace;
    workspaceRoot: string;
  },
): Promise<TaskCheckoutState[][]> {
  const targets = entries.flatMap((entry, taskIndex) =>
    listTaskCheckoutTargets({
      generatedFiles: entry.metadata?.generatedFiles,
      repositories: options.resolvedWorkspace.repositories,
      repositoryNames: entry.repositories,
      taskRoot: entry.root,
      workspaceName: options.resolvedWorkspace.manifest.metadata.name,
      workspaceRoot: options.workspaceRoot,
    }).map((target) => ({ target, taskIndex })),
  );
  const states = await mapWithConcurrency(
    targets,
    CHECKOUT_STATE_CONCURRENCY_LIMIT,
    async ({ target }) => computeCheckoutState(options.gitAdapter, target),
  );

  const perTask: TaskCheckoutState[][] = entries.map(() => []);
  targets.forEach(({ taskIndex }, index) => {
    const state = states[index];
    if (state) {
      perTask[taskIndex].push(state);
    }
  });
  return perTask;
}
