import { GitCommandExecutor } from "./git-command-executor.js";

export class GitBranchGuard {
  constructor(private readonly commandExecutor: GitCommandExecutor) {}

  assertNotOptionLike(value: string, label: string): void {
    if (value.startsWith("-")) {
      throw new Error(`Invalid ${label}: values starting with '-' are not allowed.`);
    }
  }

  async ensureValidBranchName(repoRoot: string, branchName: string): Promise<void> {
    const { exitCode } = await this.commandExecutor.runNoReject(repoRoot, [
      "check-ref-format",
      "--branch",
      branchName,
    ]);

    if (exitCode !== 0) {
      throw new Error(`Invalid branch name: ${branchName}`);
    }
  }

  async branchExists(repoRoot: string, branchName: string): Promise<boolean> {
    const { exitCode } = await this.commandExecutor.runNoReject(repoRoot, [
      "rev-parse",
      "--verify",
      branchName,
    ]);
    return exitCode === 0;
  }
}
