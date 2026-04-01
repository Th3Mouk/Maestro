import { execa } from "execa";

export class GitCommandExecutor {
  async run(repoRoot: string, args: string[]) {
    return execa("git", args, { cwd: repoRoot });
  }

  async runWithoutCwd(args: string[]) {
    return execa("git", args);
  }

  async runNoReject(repoRoot: string, args: string[]) {
    return execa("git", args, { cwd: repoRoot, reject: false });
  }

  async runWithCommitIdentity(repoRoot: string, message: string) {
    return execa(
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
  }

  async runWithFriendlyErrors(repoRoot: string, args: string[]) {
    try {
      return await this.run(repoRoot, args);
    } catch (error) {
      throw new Error(`Git command failed: git ${args.join(" ")}`, {
        cause: error instanceof Error ? error : undefined,
      });
    }
  }
}
