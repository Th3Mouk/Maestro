import { beforeEach, describe, expect, test, vi } from "vitest";
import { installWorkspace } from "../../src/core/commands/workspace-install.js";
import { resolveWorkspace, ensureWorkspaceSkeleton } from "../../src/core/workspace-service.js";
import { projectExecutionSupport } from "../../src/core/execution-service.js";
import { runPackHooks } from "../../src/core/commands/pack-hooks.js";
import { createBuiltInProjectors } from "../../src/adapters/runtimes/index.js";
import type { CommandContext, GitCommandAdapter } from "../../src/core/command-context.js";
import { getRepositorySparseIncludePaths } from "../../src/workspace/repositories.js";
import type { RepositoryRef, ResolvedWorkspace } from "../../src/workspace/types.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

function mockFn<T extends (...args: any[]) => any = (...args: any[]) => any>() {
  return vi.fn<T>();
}

vi.mock("../../src/core/workspace-service.js", () => ({
  ensureWorkspaceSkeleton: mockFn(),
  resolveWorkspace: mockFn(),
}));

vi.mock("../../src/core/execution-service.js", () => ({
  projectExecutionSupport: mockFn(),
}));

vi.mock("../../src/core/commands/pack-hooks.js", () => ({
  runPackHooks: mockFn(),
}));

vi.mock("../../src/adapters/runtimes/index.js", () => ({
  createBuiltInProjectors: mockFn(),
}));

const mockedResolveWorkspace = vi.mocked(resolveWorkspace);
const mockedEnsureWorkspaceSkeleton = vi.mocked(ensureWorkspaceSkeleton);
const mockedProjectExecutionSupport = vi.mocked(projectExecutionSupport);
const mockedRunPackHooks = vi.mocked(runPackHooks);
const mockedCreateBuiltInProjectors = vi.mocked(createBuiltInProjectors);

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

beforeEach(() => {
  mockedEnsureWorkspaceSkeleton.mockResolvedValue(undefined);
  mockedProjectExecutionSupport.mockResolvedValue([]);
  mockedRunPackHooks.mockResolvedValue([]);
  mockedCreateBuiltInProjectors.mockReturnValue([]);
});

describe("workspace install path bounding", () => {
  test("rejects repository names that escape the repos root", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-install-repo-escape-");

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

    const ensureRepository = mockFn();
    await expect(
      installWorkspace(
        workspaceRoot,
        { dryRun: true },
        createCommandContextFixture({
          gitAdapter: { ensureRepository },
        }),
      ),
    ).rejects.toThrow("repository root escapes");
    expect(ensureRepository).not.toHaveBeenCalled();
  });

  test("initializes the workspace root before repository installation", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-install-workspace-init-");
    const ensureWorkspaceRepository = mockFn().mockResolvedValue("created");
    const ensureRepository = mockFn().mockResolvedValue("created");
    const isUnbornRepository = mockFn().mockResolvedValue(false);

    mockedResolveWorkspace.mockResolvedValue(
      createResolvedWorkspaceFixture([
        {
          branch: "main",
          name: "sample",
          remote: "git@github.com:org/sample.git",
        },
      ]),
    );

    await installWorkspace(
      workspaceRoot,
      { dryRun: true },
      createCommandContextFixture({
        gitAdapter: {
          ensureWorkspaceRepository,
          ensureRepository,
          isUnbornRepository,
        },
      }),
    );

    expect(ensureWorkspaceRepository).toHaveBeenCalledTimes(1);
    expect(ensureRepository).toHaveBeenCalledTimes(1);
    expect(isUnbornRepository).not.toHaveBeenCalled();
    expect(ensureWorkspaceRepository.mock.invocationCallOrder[0]).toBeLessThan(
      ensureRepository.mock.invocationCallOrder[0],
    );
  });

  test("rejects report names that escape the reports root", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-install-report-escape-");

    mockedResolveWorkspace.mockResolvedValue(createResolvedWorkspaceFixture([]));

    await expect(
      installWorkspace(
        workspaceRoot,
        {
          dryRun: true,
          reportName: "../outside-report.json",
        },
        createCommandContextFixture({
          gitAdapter: { ensureRepository: mockFn() },
        }),
      ),
    ).rejects.toThrow("install report path escapes");
  });
});
