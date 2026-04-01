import { GitCommandExecutor } from "./git-command-executor.js";

export class GitSparseCheckout {
  constructor(private readonly commandExecutor: GitCommandExecutor) {}

  isLocalRemote(remote: string): boolean {
    return remote.startsWith("/") || remote.startsWith("file://");
  }

  inferMode(paths: string[]): "cone" | "pattern" {
    return paths.every((entry) => entry.endsWith("/")) ? "cone" : "pattern";
  }

  async isEnabled(repoRoot: string): Promise<boolean> {
    const { stdout, exitCode } = await this.commandExecutor.runNoReject(repoRoot, [
      "config",
      "--bool",
      "core.sparseCheckout",
    ]);
    return exitCode === 0 && stdout.trim() === "true";
  }
}
