import path from "node:path";
import { realpath } from "node:fs/promises";
import { execa } from "execa";
import { pathExists } from "../../utils/fs.js";
import { getTaskWorktreeMetadataPath } from "../execution/task-worktree-metadata.js";
import { workspaceManifestFileName } from "../workspace-manifest.js";

interface WorkspaceIssue {
  code: string;
  message: string;
  path?: string;
}

type MainWorkspaceResolution =
  | { workspaceRoot: string; issue?: WorkspaceIssue }
  | { error: WorkspaceIssue };

/**
 * `--workspace` defaults to the current directory, which may sit below the workspace root
 * (resolved upward first) or inside a task root, which would treat the task as a workspace
 * and nest worktrees under it. A task root carries
 * `.maestro/execution/worktree.json`; resolve the main workspace through the Git common
 * directory the task's workspace-root worktree shares with it.
 */
export async function resolveMainWorkspaceRoot(
  startDirectory: string,
): Promise<MainWorkspaceResolution> {
  const workspaceRoot = await findEnclosingWorkspaceRoot(startDirectory);
  if (!(await pathExists(getTaskWorktreeMetadataPath(workspaceRoot)))) {
    return { workspaceRoot };
  }

  const mainWorkspaceRoot = await findMainWorktreeRoot(workspaceRoot);
  if (mainWorkspaceRoot) {
    return {
      workspaceRoot: mainWorkspaceRoot,
      issue: {
        code: "WORKSPACE_RESOLVED_FROM_TASK",
        message: `${workspaceRoot} is a task worktree; operating on the main workspace ${mainWorkspaceRoot}.`,
        path: mainWorkspaceRoot,
      },
    };
  }

  return {
    error: {
      code: "WORKSPACE_IS_TASK_WORKTREE",
      message: `${workspaceRoot} is a task worktree and its main workspace cannot be resolved; pass --workspace <main workspace>.`,
      path: workspaceRoot,
    },
  };
}

/**
 * The closest directory, `startDirectory` included, that is a workspace (it has the manifest)
 * or a task root, so worktree commands work from anywhere inside one: a repository checkout,
 * a subdirectory. `startDirectory` itself when no parent qualifies.
 */
async function findEnclosingWorkspaceRoot(startDirectory: string): Promise<string> {
  let current = startDirectory;
  for (;;) {
    if (
      (await pathExists(path.join(current, workspaceManifestFileName))) ||
      (await pathExists(getTaskWorktreeMetadataPath(current)))
    ) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return startDirectory;
    }
    current = parent;
  }
}

async function findMainWorktreeRoot(taskRoot: string): Promise<string | undefined> {
  const { exitCode, stdout } = await execa(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd: taskRoot, reject: false },
  );
  const commonDir = stdout.trim();
  if (exitCode !== 0 || path.basename(commonDir) !== ".git") {
    return undefined;
  }

  const candidate = path.dirname(commonDir);
  const isTaskRoot = (await realpath(candidate)) === (await realpath(taskRoot));
  if (isTaskRoot || !(await pathExists(path.join(candidate, workspaceManifestFileName)))) {
    return undefined;
  }
  return candidate;
}
