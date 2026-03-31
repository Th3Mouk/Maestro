import path from "node:path";

export const workspaceStateDirName = ".maestro";

export function getWorkspaceStateRoot(workspaceRoot: string, ...segments: string[]): string {
  return path.join(workspaceRoot, workspaceStateDirName, ...segments);
}
