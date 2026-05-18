import path from "node:path";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import { mapWithConcurrency, resolveSafePath } from "../../utils/fs.js";
import type { GitCommandAdapter } from "../command-context.js";

const INSTALL_REPOSITORY_CONCURRENCY_LIMIT = 4;

interface RepositoryProgressReporter {
  itemCompleted: () => void;
  itemStarted: (label: string, index: number) => void;
}

interface RepositoryInstallResult {
  name: string;
  path: string;
  status: "created" | "updated" | "unchanged";
}

export async function materializeWorkspaceRepositories(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  dryRun: boolean,
  gitAdapter: Pick<GitCommandAdapter, "ensureRepository">,
  repositoryProgress: RepositoryProgressReporter,
): Promise<RepositoryInstallResult[]> {
  return mapWithConcurrency(
    resolvedWorkspace.repositories,
    INSTALL_REPOSITORY_CONCURRENCY_LIMIT,
    async (repository, index) => {
      repositoryProgress.itemStarted(repository.name, index);
      const repoRoot = resolveSafePath(
        workspaceRoot,
        path.join("repos", repository.name),
        "repository root",
      );
      let status: "created" | "updated" | "unchanged";
      try {
        status = await gitAdapter.ensureRepository(repoRoot, repository, dryRun);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to ensure repository "${repository.name}" (${repository.remote}): ${detail}`,
          { cause: error instanceof Error ? error : undefined },
        );
      }
      repositoryProgress.itemCompleted();
      return { name: repository.name, path: repoRoot, status };
    },
  );
}
