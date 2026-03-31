import { describe, expect, test, vi } from "vitest";
import { resolveWorkspace } from "../../src/core/workspace-service.js";
import { syncWorkspaceGitBranches } from "../../src/core/commands/workspace-git.js";
import type { CommandContext, GitCommandAdapter } from "../../src/core/command-context.js";
import { getRepositorySparseIncludePaths } from "../../src/workspace/repositories.js";
import type { RepositoryRef, ResolvedWorkspace } from "../../src/workspace/types.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

function mockFn<T extends (...args: any[]) => any = (...args: any[]) => any>() {
  return vi.fn<T>();
}

vi.mock("../../src/core/workspace-service.js", () => ({
  resolveWorkspace: mockFn(),
}));

const mockedResolveWorkspace = vi.mocked(resolveWorkspace);

function createResolvedWorkspaceFixture(repositories: RepositoryRef[]): ResolvedWorkspace {
  return {
    execution: {
      devcontainer: { enabled: false },
      worktrees: { enabled: true },
    },
    lockfile: {
      frameworkVersion: "0.0.0-test",
      generatedAt: "1970-01-01T00:00:00.000Z",
      packs: [],
      repositories: repositories.map((repository) => ({
        branch: repository.branch,
        name: repository.name,
        sparsePaths: getRepositorySparseIncludePaths(repository),
      })),
    },
    manifest: {
      apiVersion: "maestro/v1",
      kind: "Workspace",
      metadata: { name: "demo-workspace" },
      spec: {
        repositories,
        runtimes: {},
      },
    },
    packs: [],
    repositories,
    runtimes: {},
    plugins: {},
    selectedAgents: {
      codex: [],
      "claude-code": [],
      opencode: [],
    },
    selectedPolicies: [],
    selectedSkills: [],
    mcpServers: [],
    workspaceRoot: "/tmp/demo-workspace",
  };
}

function createCommandContextFixture(
  overrides: {
    gitAdapter?: Partial<GitCommandAdapter>;
    stderr?: NodeJS.WriteStream;
  } = {},
): CommandContext {
  const defaultGitAdapter: GitCommandAdapter = {
    checkoutBranch: mockFn().mockResolvedValue({ branch: "main", status: "unchanged" }),
    ensureWorkspaceRepository: mockFn().mockResolvedValue("unchanged"),
    ensureRepository: mockFn().mockResolvedValue("unchanged"),
    ensureWorktree: mockFn().mockResolvedValue("unchanged"),
    commitAll: mockFn().mockResolvedValue(false),
    isUnbornRepository: mockFn().mockResolvedValue(false),
    getChangedFiles: mockFn().mockResolvedValue([]),
    getCommittedChangedFiles: mockFn().mockResolvedValue([]),
    getCurrentBranch: mockFn().mockResolvedValue("main"),
    getRemoteUrl: mockFn().mockResolvedValue("git@github.com:org/repo.git"),
    hasGitMetadata: mockFn().mockResolvedValue(true),
    isClean: mockFn().mockResolvedValue(true),
    pullCurrentBranch: mockFn().mockResolvedValue({ branch: "main", status: "unchanged" }),
  };
  return {
    gitAdapter: { ...defaultGitAdapter, ...overrides.gitAdapter },
    stderr: overrides.stderr ?? process.stderr,
  };
}

describe("workspace command path bounding", () => {
  test("reports an error when git command repository name escapes the repos root", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-git-repo-escape-");
    mockedResolveWorkspace.mockResolvedValue(
      createResolvedWorkspaceFixture([
        {
          branch: "main",
          name: "../../evil",
          remote: "git@github.com:org/evil.git",
          sparse: {
            visiblePaths: ["."],
          },
        },
      ]),
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
