import path from "node:path";
import { execa } from "execa";
import type { RepositoryRef } from "../../workspace/types.js";
import { pathExists } from "../../utils/fs.js";
import {
  buildRepositorySparseCheckoutPatterns,
  getRepositoryReferenceBranch,
  hasRepositorySparseCheckout,
} from "../../workspace/repositories.js";

interface GitDiffStats {
  files: number;
  added: number;
  deleted: number;
}

interface GitOperationResult {
  branch: string;
  status: "updated" | "unchanged";
}

export class GitAdapter {
  async ensureWorkspaceRepository(
    workspaceRoot: string,
    dryRun = false,
  ): Promise<"created" | "unchanged"> {
    const exists = await this.hasGitMetadata(workspaceRoot);
    if (exists) {
      return "unchanged";
    }

    if (dryRun) {
      return "created";
    }

    await this.run(workspaceRoot, ["init", "--initial-branch=main"]);
    return "created";
  }

  async isUnbornRepository(repoRoot: string): Promise<boolean> {
    const { exitCode } = await execa("git", ["rev-parse", "--verify", "HEAD"], {
      cwd: repoRoot,
      reject: false,
    });
    return exitCode !== 0;
  }

  async ensureRepository(
    repoRoot: string,
    repository: RepositoryRef,
    dryRun = false,
  ): Promise<"created" | "updated" | "unchanged"> {
    const exists = await this.hasGitMetadata(repoRoot);
    if (!exists) {
      if (dryRun) {
        return "created";
      }

      const referenceBranch = getRepositoryReferenceBranch(repository);
      this.#assertNotOptionLike(repository.remote, "remote URL");
      const cloneArgs = ["clone", "--no-checkout", "--branch", referenceBranch];
      if (hasRepositorySparseCheckout(repository) && !this.#isLocalRemote(repository.remote)) {
        cloneArgs.push("--filter=blob:none");
      }
      cloneArgs.push("--", repository.remote, repoRoot);
      await execa("git", cloneArgs);
      await this.#configureRepository(repoRoot, repository, referenceBranch);
      return "created";
    }

    if (dryRun) {
      return "updated";
    }

    this.#assertNotOptionLike(repository.remote, "remote URL");
    await this.run(repoRoot, ["remote", "set-url", "origin", "--", repository.remote]);
    await this.run(repoRoot, ["fetch", "--all", "--prune"]);
    await this.#configureRepository(repoRoot, repository, getRepositoryReferenceBranch(repository));
    return "updated";
  }

  async ensureBranch(
    repoRoot: string,
    branchName: string,
    baseBranch: string,
    dryRun = false,
  ): Promise<void> {
    if (dryRun) {
      return;
    }

    await this.#ensureValidBranchName(repoRoot, branchName);
    await this.#ensureValidBranchName(repoRoot, baseBranch);
    const currentBranch = await this.getCurrentBranch(repoRoot);
    if (currentBranch === branchName) {
      return;
    }

    const branchExists = await this.#branchExists(repoRoot, branchName);
    if (branchExists) {
      await this.run(repoRoot, ["checkout", branchName]);
      return;
    }

    await this.run(repoRoot, ["checkout", baseBranch]);
    await this.run(repoRoot, ["checkout", "-b", branchName]);
  }

  async commitAll(repoRoot: string, message: string, dryRun = false): Promise<boolean> {
    const changedFiles = await this.getChangedFiles(repoRoot);
    if (changedFiles.length === 0) {
      return false;
    }

    if (dryRun) {
      return true;
    }

    await this.run(repoRoot, ["add", "."]);
    await execa(
      "git",
      [
        "-c",
        "user.name=Maestro",
        "-c",
        "user.email=maestro@example.invalid",
        "-c",
        "commit.gpgSign=false",
        "commit",
        "-m",
        message,
      ],
      { cwd: repoRoot },
    );
    return true;
  }

  async push(repoRoot: string, branchName: string, dryRun = false): Promise<void> {
    if (dryRun) {
      return;
    }

    await this.#ensureValidBranchName(repoRoot, branchName);
    await this.run(repoRoot, ["push", "-u", "--", "origin", branchName]);
  }

  async getCurrentBranch(repoRoot: string): Promise<string> {
    const { stdout } = await this.run(repoRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
    return stdout.trim();
  }

  async checkoutBranch(repoRoot: string, branchName: string): Promise<GitOperationResult> {
    await this.#ensureValidBranchName(repoRoot, branchName);
    const currentBranch = await this.getCurrentBranch(repoRoot);
    if (currentBranch === branchName) {
      return { branch: branchName, status: "unchanged" };
    }

    if (!(await this.isClean(repoRoot))) {
      throw new Error(`Cannot checkout ${branchName}: working tree is not clean.`);
    }

    await this.fetch(repoRoot);
    const localBranchExists = await this.#branchExists(repoRoot, branchName);
    if (localBranchExists) {
      await this.run(repoRoot, ["checkout", branchName]);
      return { branch: branchName, status: "updated" };
    }

    await this.run(repoRoot, ["checkout", "-b", branchName, "--track", `origin/${branchName}`]);
    return { branch: branchName, status: "updated" };
  }

  async pullCurrentBranch(repoRoot: string): Promise<GitOperationResult> {
    const branchName = await this.getCurrentBranch(repoRoot);
    if (branchName === "HEAD") {
      throw new Error("Cannot pull: repository is in detached HEAD state.");
    }

    await this.#ensureValidBranchName(repoRoot, branchName);
    if (!(await this.isClean(repoRoot))) {
      throw new Error(`Cannot pull ${branchName}: working tree is not clean.`);
    }

    await this.fetch(repoRoot);
    const result = await this.run(repoRoot, [
      "pull",
      "--ff-only",
      "--no-rebase",
      "origin",
      branchName,
    ]);
    const output = `${result.stdout}\n${result.stderr}`.trim();
    return {
      branch: branchName,
      status: output.includes("Already up to date.") ? "unchanged" : "updated",
    };
  }

  async getChangedFiles(repoRoot: string): Promise<string[]> {
    const { stdout } = await this.run(repoRoot, ["status", "--short"]);
    return stdout
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3).trim());
  }

  async getCommittedChangedFiles(repoRoot: string, baseRef: string): Promise<string[]> {
    const { stdout } = await this.run(repoRoot, ["diff", "--name-only", `${baseRef}...HEAD`]);
    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }

  async getDiffStats(repoRoot: string): Promise<GitDiffStats> {
    const { stdout } = await this.run(repoRoot, ["diff", "--numstat"]);
    const entries = stdout.split("\n").filter(Boolean);
    const stats = entries.reduce(
      (accumulator, entry) => {
        const [added, deleted] = entry.split("\t");
        accumulator.files += 1;
        accumulator.added += Number.parseInt(added, 10) || 0;
        accumulator.deleted += Number.parseInt(deleted, 10) || 0;
        return accumulator;
      },
      { files: 0, added: 0, deleted: 0 },
    );
    return stats;
  }

  async getRemoteUrl(repoRoot: string): Promise<string> {
    const { stdout } = await this.run(repoRoot, ["remote", "get-url", "origin"]);
    return stdout.trim();
  }

  async isClean(repoRoot: string): Promise<boolean> {
    const { stdout } = await this.run(repoRoot, ["status", "--porcelain", "--untracked-files=no"]);
    return stdout.trim().length === 0;
  }

  async hasGitMetadata(repoRoot: string): Promise<boolean> {
    return pathExists(path.join(repoRoot, ".git"));
  }

  async fetch(repoRoot: string): Promise<void> {
    await this.run(repoRoot, ["fetch", "--all", "--prune"]);
  }

  async ensureWorktree(
    repoRoot: string,
    worktreePath: string,
    branchName: string,
    baseRef = "HEAD",
    dryRun = false,
  ): Promise<"created" | "updated" | "unchanged"> {
    await this.#ensureValidBranchName(repoRoot, branchName);
    const exists = await this.hasGitMetadata(worktreePath);
    if (exists) {
      return "unchanged";
    }

    if (dryRun) {
      return "created";
    }

    await execa("git", ["worktree", "add", "-B", branchName, "--", worktreePath, baseRef], {
      cwd: repoRoot,
    });
    return "created";
  }

  async run(repoRoot: string, args: string[]) {
    try {
      return await execa("git", args, { cwd: repoRoot });
    } catch (error) {
      throw new Error(`Git command failed: git ${args.join(" ")}`, {
        cause: error instanceof Error ? error : undefined,
      });
    }
  }

  async #configureRepository(
    repoRoot: string,
    repository: RepositoryRef,
    referenceBranch: string,
  ): Promise<void> {
    await this.#ensureValidBranchName(repoRoot, referenceBranch);

    if (!hasRepositorySparseCheckout(repository)) {
      if (await this.#isSparseCheckoutEnabled(repoRoot)) {
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
        : (repository.sparse?.mode ?? this.#inferSparseMode(includePaths));
    await this.run(repoRoot, ["sparse-checkout", "init", mode === "cone" ? "--cone" : "--no-cone"]);
    await this.run(repoRoot, ["sparse-checkout", "set", "--", ...sparsePaths]);
    await this.run(repoRoot, ["checkout", referenceBranch]);
  }

  #isLocalRemote(remote: string): boolean {
    return remote.startsWith("/") || remote.startsWith("file://");
  }

  #inferSparseMode(paths: string[]): "cone" | "pattern" {
    return paths.every((entry) => entry.endsWith("/")) ? "cone" : "pattern";
  }

  async #branchExists(repoRoot: string, branchName: string): Promise<boolean> {
    const { exitCode } = await execa("git", ["rev-parse", "--verify", branchName], {
      cwd: repoRoot,
      reject: false,
    });
    return exitCode === 0;
  }

  #assertNotOptionLike(value: string, label: string): void {
    if (value.startsWith("-")) {
      throw new Error(`Invalid ${label}: values starting with '-' are not allowed.`);
    }
  }

  async #isSparseCheckoutEnabled(repoRoot: string): Promise<boolean> {
    const { stdout, exitCode } = await execa("git", ["config", "--bool", "core.sparseCheckout"], {
      cwd: repoRoot,
      reject: false,
    });
    return exitCode === 0 && stdout.trim() === "true";
  }

  async #ensureValidBranchName(repoRoot: string, branchName: string): Promise<void> {
    const { exitCode } = await execa("git", ["check-ref-format", "--branch", branchName], {
      cwd: repoRoot,
      reject: false,
    });

    if (exitCode !== 0) {
      throw new Error(`Invalid branch name: ${branchName}`);
    }
  }
}
