import path from "node:path";
import { resolveSafePath } from "../../utils/fs.js";
import { workspaceStateDirName } from "../../workspace/state-directory.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";

export function getTaskWorktreesRoot(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
): string {
  return resolveSafePath(
    workspaceRoot,
    resolvedWorkspace.execution.worktrees?.rootDir ?? path.join(workspaceStateDirName, "worktrees"),
    "worktree rootDir",
  );
}
