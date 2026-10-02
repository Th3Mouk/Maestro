import path from "node:path";
import { lstat } from "node:fs/promises";
import { execa } from "execa";
import type { ForeignDirectory, TaskCheckoutState } from "../../report/types.js";
import { listDirectories, mapWithConcurrency } from "../../utils/fs.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import type { ForgeClient, ForgeName } from "../../adapters/forge/github-forge.js";
import {
  applyForgeIntegration,
  needsForgeLookup,
  type ForgeLookup,
} from "../execution/forge-integration.js";
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
  metadata: Partial<TaskWorktreeMetadata>;
  name: string;
  repositories: string[];
  root: string;
}

const CHECKOUT_STATE_CONCURRENCY_LIMIT = 8;

/**
 * The task worktrees under `rootDir`, and the directories that are not tasks: a directory
 * without `.maestro/execution/worktree.json` was not created by `maestro worktree create`
 * (a hand-made `git worktree add`, a clone, any folder) and is never removed by Maestro.
 */
export async function listTaskWorktreeEntries(
  worktreesRoot: string,
): Promise<{ entries: TaskWorktreeEntry[]; foreign: ForeignDirectory[] }> {
  const directoryNames = await listDirectories(worktreesRoot);
  const results = await Promise.all(
    directoryNames.map(async (directoryName) => {
      const root = path.join(worktreesRoot, directoryName);
      const metadata = await readTaskWorktreeMetadata(root);
      if (!metadata) {
        return { foreign: await describeForeignDirectory(root) };
      }
      return {
        entry: {
          createdAt: metadata.createdAt ?? "",
          directoryName,
          metadata,
          name: metadata.name ?? directoryName,
          repositories: await listTaskRepositoryNames(root, metadata),
          root,
        },
      };
    }),
  );
  return {
    entries: results.flatMap((result) => (result.entry ? [result.entry] : [])),
    foreign: results.flatMap((result) => (result.foreign ? [result.foreign] : [])),
  };
}

export async function describeForeignDirectory(directory: string): Promise<ForeignDirectory> {
  const gitPath = path.join(directory, ".git");
  const stats = await lstat(gitPath).catch(() => undefined);
  if (stats?.isDirectory()) {
    return { path: directory, kind: "git-repository" };
  }
  if (!stats?.isFile()) {
    return { path: directory, kind: "directory" };
  }

  // A `.git` file points at the repository this worktree belongs to.
  const { exitCode, stdout } = await execa(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: directory, reject: false },
  );
  const commonDir = stdout.trim();
  if (exitCode !== 0 || !commonDir) {
    return { path: directory, kind: "git-worktree" };
  }
  return {
    path: directory,
    kind: "git-worktree",
    source: path.basename(commonDir) === ".git" ? path.dirname(commonDir) : commonDir,
  };
}

export function createForeignDirectoryIssue(foreign: ForeignDirectory): {
  code: string;
  message: string;
  path: string;
} {
  const source = foreign.source ? ` of ${foreign.source}` : "";
  return {
    code: "WORKTREE_FOREIGN",
    message: `${foreign.path} is not a Maestro task worktree (${foreign.kind}${source}); left untouched.`,
    path: foreign.path,
  };
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
      generatedFiles: entry.metadata.generatedFiles,
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

/**
 * Asks the forge about the checkouts whose upstream is gone and whose work Git could not
 * find in the reference branch. Returns the `FORGE_UNAVAILABLE` issue, if any.
 */
export async function applyForgeToTaskCheckouts(
  checkouts: TaskCheckoutState[][],
  options: {
    client: ForgeClient;
    concurrencyLimit: number;
    forge: ForgeName;
    gitAdapter: Parameters<typeof applyForgeIntegration>[1]["gitAdapter"];
  },
): Promise<{ code: string; message: string } | undefined> {
  const lookups: ForgeLookup[] = checkouts
    .flat()
    .flatMap((state) =>
      state.branch && needsForgeLookup(state)
        ? [{ branch: state.branch, repoRoot: state.path, state }]
        : [],
    );
  if (lookups.length === 0) {
    return undefined;
  }
  return applyForgeIntegration(lookups, options);
}
