import { execa } from "execa";

function extractStderr(error: unknown): string {
  if (error && typeof error === "object" && "stderr" in error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    if (typeof stderr === "string") {
      return stderr.trim();
    }
  }
  return "";
}

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
      const stderr = extractStderr(error);
      const suffix = stderr ? `\n${stderr}` : "";
      throw new Error(`Git command failed: git ${args.join(" ")}${suffix}`, {
        cause: error instanceof Error ? error : undefined,
      });
    }
  }
}
