import type { ResolvedWorkspace } from "../../workspace/types.js";
import { listDirectories, removeIfExists, resolveSafePath } from "../../utils/fs.js";
import type { GitCommandAdapter } from "../command-context.js";

export async function removeStaleWorkspaceRepositories(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  gitAdapter: Pick<GitCommandAdapter, "isClean">,
  dryRun: boolean,
): Promise<void> {
  const desiredRepos = new Set(resolvedWorkspace.repositories.map((entry) => entry.name));
  const reposRoot = resolveSafePath(workspaceRoot, "repos", "repositories root");
  const existingRepos = await listDirectories(reposRoot);

  for (const repoName of existingRepos.filter((entry) => !desiredRepos.has(entry))) {
    const repoRoot = resolveSafePath(reposRoot, repoName, "repository root");
    if (!(await gitAdapter.isClean(repoRoot))) {
      throw new Error(`Cannot remove ${repoName}: working tree is not clean.`);
    }

    if (!dryRun) {
      await removeIfExists(repoRoot);
    }
  }
}
