import { vi } from "vitest";
import type { CommandContext, GitCommandAdapter } from "../../src/core/command-context.js";
import { JsonRenderer } from "../../src/cli/output/json-renderer.js";
import type { Renderer } from "../../src/cli/output/renderer.js";

export function mockFn<T extends (...args: any[]) => any = (...args: any[]) => any>() {
  return vi.fn<T>();
}

export function createGitCommandAdapterFixture(
  overrides: Partial<GitCommandAdapter> = {},
): GitCommandAdapter {
  return {
    checkoutBranch: mockFn().mockResolvedValue({ branch: "main", status: "unchanged" }),
    ensureWorkspaceRepository: mockFn().mockResolvedValue("unchanged"),
    ensureRepository: mockFn().mockResolvedValue("unchanged"),
    ensureWorktree: mockFn().mockResolvedValue("unchanged"),
    deleteBranch: mockFn().mockResolvedValue(undefined),
    fetch: mockFn().mockResolvedValue(undefined),
    fetchBranch: mockFn().mockResolvedValue(undefined),
    inspectRef: mockFn().mockResolvedValue({
      branch: "main",
      integrated: true,
      localOnly: 0,
      upstream: "tracking",
    }),
    listTaskBranches: mockFn().mockResolvedValue([]),
    listWorktrees: mockFn().mockResolvedValue([]),
    pruneWorktrees: mockFn().mockResolvedValue(undefined),
    localBranchExists: mockFn().mockResolvedValue(false),
    remoteBranchExists: mockFn().mockResolvedValue(true),
    resolveDefaultBranchRef: mockFn().mockResolvedValue("origin/main"),
    commitAll: mockFn().mockResolvedValue(false),
    listUncommittedChanges: mockFn().mockResolvedValue([]),
    isUnbornRepository: mockFn().mockResolvedValue(false),
    getChangedFiles: mockFn().mockResolvedValue([]),
    getCommittedChangedFiles: mockFn().mockResolvedValue([]),
    getCurrentBranch: mockFn().mockResolvedValue("main"),
    getRemoteUrl: mockFn().mockResolvedValue("git@github.com:org/repo.git"),
    hasGitMetadata: mockFn().mockResolvedValue(true),
    isClean: mockFn().mockResolvedValue(true),
    pullCurrentBranch: mockFn().mockResolvedValue({ branch: "main", status: "unchanged" }),
    removeWorktree: mockFn().mockResolvedValue("removed"),
    ...overrides,
  };
}

export function createCommandContextFixture(
  overrides: {
    gitAdapter?: Partial<GitCommandAdapter>;
    stderr?: NodeJS.WriteStream;
    renderer?: Renderer;
  } = {},
): CommandContext {
  return {
    gitAdapter: createGitCommandAdapterFixture(overrides.gitAdapter),
    stderr: overrides.stderr ?? process.stderr,
    renderer: overrides.renderer ?? new JsonRenderer(),
  };
}
