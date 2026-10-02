import { execa } from "execa";

/** A forge Maestro can ask whether a branch's pull request was merged. */
export interface ForgeClient {
  /**
   * The merged pull request whose head was `branch` on the repository behind `remoteUrl`,
   * or `undefined` when there is none or the remote is not on this forge. Throws
   * {@link ForgeUnavailableError} when the forge cannot be asked at all.
   */
  findMergedPullRequest(remoteUrl: string, branch: string): Promise<{ number: number } | undefined>;
}

export type ForgeName = "github";

export class ForgeUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ForgeUnavailableError";
  }
}

const githubRemotePatterns = [
  /^git@github\.com:(?<repository>[^/]+\/[^/]+?)(?:\.git)?\/?$/,
  /^(?:https?|ssh|git):\/\/(?:[^@/]+@)?github\.com(?::\d+)?\/(?<repository>[^/]+\/[^/]+?)(?:\.git)?\/?$/,
];

/** `owner/repo` for a GitHub remote URL, `undefined` for any other remote. */
export function parseGitHubRepository(remoteUrl: string): string | undefined {
  for (const pattern of githubRemotePatterns) {
    const repository = pattern.exec(remoteUrl.trim())?.groups?.repository;
    if (repository) {
      return repository;
    }
  }
  return undefined;
}

/** Asks GitHub through the `gh` CLI, with the user's own authentication. */
export class GitHubForgeClient implements ForgeClient {
  async findMergedPullRequest(
    remoteUrl: string,
    branch: string,
  ): Promise<{ number: number } | undefined> {
    const repository = parseGitHubRepository(remoteUrl);
    if (!repository) {
      return undefined;
    }

    let stdout: string;
    try {
      ({ stdout } = await execa("gh", [
        "pr",
        "list",
        "--repo",
        repository,
        "--head",
        branch,
        "--state",
        "merged",
        "--json",
        "number,mergedAt",
      ]));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      throw new ForgeUnavailableError(
        code === "ENOENT"
          ? "the GitHub CLI (gh) is not installed"
          : `gh could not query ${repository} (is it authenticated? run \`gh auth status\`)`,
        { cause: error },
      );
    }

    const pullRequests = JSON.parse(stdout) as Array<{ number: number; mergedAt?: string }>;
    const merged = pullRequests.find((pullRequest) => pullRequest.mergedAt);
    return merged ? { number: merged.number } : undefined;
  }
}
