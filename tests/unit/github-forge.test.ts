import { describe, expect, onTestFinished, test, vi } from "vitest";
import {
  ForgeUnavailableError,
  GitHubForgeClient,
  parseGitHubRepository,
} from "../../src/adapters/forge/github-forge.js";

describe("parseGitHubRepository", () => {
  test.each([
    ["git@github.com:positive/platform-api.git", "positive/platform-api"],
    ["git@github.com:positive/platform-api", "positive/platform-api"],
    ["https://github.com/positive/foods.git", "positive/foods"],
    ["https://github.com/positive/foods", "positive/foods"],
    ["https://token@github.com/positive/foods.git", "positive/foods"],
    ["ssh://git@github.com/positive/foods.git", "positive/foods"],
    ["ssh://git@github.com:22/positive/foods.git", "positive/foods"],
  ])("%s → %s", (remoteUrl, repository) => {
    expect(parseGitHubRepository(remoteUrl)).toBe(repository);
  });

  test.each([
    "git@gitlab.com:positive/foods.git",
    "/tmp/remotes/foods.git",
    "https://github.com/positive",
  ])("%s is not a GitHub repository", (remoteUrl) => {
    expect(parseGitHubRepository(remoteUrl)).toBeUndefined();
  });
});

describe("GitHubForgeClient", () => {
  test("does not ask about a remote that is not on GitHub", async () => {
    await expect(
      new GitHubForgeClient().findMergedPullRequest("/tmp/remotes/foods.git", "main"),
    ).resolves.toBeUndefined();
  });

  test("a missing gh CLI makes the forge unavailable", async () => {
    vi.stubEnv("PATH", "/nonexistent");
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });

    await expect(
      new GitHubForgeClient().findMergedPullRequest("git@github.com:positive/foods.git", "x"),
    ).rejects.toBeInstanceOf(ForgeUnavailableError);
  });
});
