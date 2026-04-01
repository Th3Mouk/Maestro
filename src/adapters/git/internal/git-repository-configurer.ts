import type { RepositoryRef } from "../../../workspace/types.js";
import {
  buildRepositorySparseCheckoutPatterns,
  hasRepositorySparseCheckout,
} from "../../../workspace/repositories.js";
import { GitBranchGuard } from "./git-branch-guard.js";
import { GitSparseCheckout } from "./git-sparse-checkout.js";

type GitRun = (repoRoot: string, args: string[]) => Promise<unknown>;

export class GitRepositoryConfigurer {
  constructor(
    private readonly branchGuard: GitBranchGuard,
    private readonly sparseCheckout: GitSparseCheckout,
    private readonly run: GitRun,
  ) {}

  async configure(
    repoRoot: string,
    repository: RepositoryRef,
    referenceBranch: string,
  ): Promise<void> {
    await this.branchGuard.ensureValidBranchName(repoRoot, referenceBranch);

    if (!hasRepositorySparseCheckout(repository)) {
      if (await this.sparseCheckout.isEnabled(repoRoot)) {
        await this.run(repoRoot, ["sparse-checkout", "disable"]);
      }
      await this.run(repoRoot, ["checkout", referenceBranch]);
      return;
    }

    const includePaths = repository.sparse?.includePaths ?? repository.sparse?.visiblePaths ?? [];
    const excludePaths = repository.sparse?.excludePaths ?? [];
    const sparsePaths = buildRepositorySparseCheckoutPatterns(repository);
    const mode =
      excludePaths.length > 0
        ? "pattern"
        : (repository.sparse?.mode ?? this.sparseCheckout.inferMode(includePaths));
    await this.run(repoRoot, ["sparse-checkout", "init", mode === "cone" ? "--cone" : "--no-cone"]);
    await this.run(repoRoot, ["sparse-checkout", "set", "--", ...sparsePaths]);
    await this.run(repoRoot, ["checkout", referenceBranch]);
  }
}
