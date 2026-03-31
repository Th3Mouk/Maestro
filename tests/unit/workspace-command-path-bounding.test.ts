import { describe, expect, test, vi } from "vitest";
import { resolveWorkspace } from "../../src/core/workspace-service.js";
import { syncWorkspaceGitBranches } from "../../src/core/commands/workspace-git.js";
import type { CommandContext, GitCommandAdapter } from "../../src/core/command-context.js";
import { getRepositorySparseIncludePaths } from "../../src/workspace/repositories.js";
import type { RepositoryRef, ResolvedWorkspace } from "../../src/workspace/types.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

vi.mock("../../src/core/workspace-service.js", () => ({
  resolveWorkspace: vi.fn(),
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
    checkoutBranch: vi.fn().mockResolvedValue({ branch: "main", status: "unchanged" }),
    ensureWorkspaceRepository: vi.fn().mockResolvedValue("unchanged"),
    ensureRepository: vi.fn().mockResolvedValue("unchanged"),
    ensureWorktree: vi.fn().mockResolvedValue("unchanged"),
    commitAll: vi.fn().mockResolvedValue(false),
    isUnbornRepository: vi.fn().mockResolvedValue(false),
    getChangedFiles: vi.fn().mockResolvedValue([]),
    getCommittedChangedFiles: vi.fn().mockResolvedValue([]),
    getCurrentBranch: vi.fn().mockResolvedValue("main"),
    getRemoteUrl: vi.fn().mockResolvedValue("git@github.com:org/repo.git"),
    hasGitMetadata: vi.fn().mockResolvedValue(true),
    isClean: vi.fn().mockResolvedValue(true),
    pullCurrentBranch: vi.fn().mockResolvedValue({ branch: "main", status: "unchanged" }),
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
          checkoutBranch: vi.fn(),
          getCurrentBranch: vi.fn(),
          hasGitMetadata: vi.fn(),
          pullCurrentBranch: vi.fn(),
        },
      }),
    );

    expect(report.status).toBe("error");
    expect(report.issues[0]?.message).toContain("repository root escapes");
  });
});
