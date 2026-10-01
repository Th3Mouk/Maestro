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
 * `--workspace` defaults to the current directory, so a command run from inside a task root
 * would treat the task as a workspace and nest worktrees under it. A task root carries
 * `.maestro/execution/worktree.json`; resolve the main workspace through the Git common
 * directory the task's workspace-root worktree shares with it.
 */
export async function resolveMainWorkspaceRoot(
  workspaceRoot: string,
): Promise<MainWorkspaceResolution> {
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
