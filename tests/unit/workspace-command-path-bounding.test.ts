import { describe, expect, test, vi } from "vitest";
import { resolveWorkspace } from "../../src/core/workspace-service.js";
import { syncWorkspaceGitBranches } from "../../src/core/commands/workspace-git.js";
import { createResolvedWorkspaceFixture } from "../utils/execution-fixtures.js";
import { createCommandContextFixture } from "../utils/test-doubles.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

function mockFn<T extends (...args: any[]) => any = (...args: any[]) => any>() {
  return vi.fn<T>();
}

vi.mock("../../src/core/workspace-service.js", () => ({
  resolveWorkspace: mockFn(),
}));

const mockedResolveWorkspace = vi.mocked(resolveWorkspace);

describe("workspace command path bounding", () => {
  test("reports an error when git command repository name escapes the repos root", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-git-repo-escape-");
    mockedResolveWorkspace.mockResolvedValue(
      createResolvedWorkspaceFixture({
        repositories: [
          {
            branch: "main",
            name: "../../evil",
            remote: "git@github.com:org/evil.git",
            sparse: {
              visiblePaths: ["."],
            },
          },
        ],
      }),
    );

    const report = await syncWorkspaceGitBranches(
      workspaceRoot,
      createCommandContextFixture({
        gitAdapter: {
          checkoutBranch: mockFn(),
          getCurrentBranch: mockFn(),
          hasGitMetadata: mockFn(),
          pullCurrentBranch: mockFn(),
        },
      }),
    );

    expect(report.status).toBe("error");
    expect(report.issues[0]?.message).toContain("repository root escapes");
  });

  test("reports an error when git command repository name has nested traversal escape", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-git-nested-repo-escape-");
    const escapedRepositoryName = "nested/../../../../evil";
    mockedResolveWorkspace.mockResolvedValue(
      createResolvedWorkspaceFixture({
        repositories: [
          {
            branch: "main",
            name: escapedRepositoryName,
            remote: "git@github.com:org/evil.git",
            sparse: {
              visiblePaths: ["."],
            },
          },
        ],
      }),
    );

    const report = await syncWorkspaceGitBranches(
      workspaceRoot,
      createCommandContextFixture({
        gitAdapter: {
          checkoutBranch: mockFn(),
          getCurrentBranch: mockFn(),
          hasGitMetadata: mockFn(),
          pullCurrentBranch: mockFn(),
        },
      }),
    );

    expect(report.status).toBe("error");
    expect(report.issues[0]?.message).toContain("repository root escapes");
  });
});
