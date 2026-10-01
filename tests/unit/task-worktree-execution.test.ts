import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  createDryRunTaskRepositories,
  createTaskWorktreeReport,
  createWorktreesDisabledIssue,
  mergeTaskRepositoryOutcomes,
  prepareTaskRepositories,
  prepareTaskWorkspaceRoot,
} from "../../src/core/execution/task-worktree-execution.js";
import type { TaskWorktreeGitAdapter } from "../../src/core/execution/task-worktree-execution.js";
import { createRepositoryFixture } from "../utils/execution-fixtures.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

function createTaskWorktreeGitAdapterFixture(
  overrides: Partial<TaskWorktreeGitAdapter> = {},
): TaskWorktreeGitAdapter {
  return {
    ensureWorktree: vi.fn<TaskWorktreeGitAdapter["ensureWorktree"]>().mockResolvedValue("created"),
    fetchBranch: vi.fn<TaskWorktreeGitAdapter["fetchBranch"]>().mockResolvedValue(undefined),
    hasGitMetadata: vi.fn<TaskWorktreeGitAdapter["hasGitMetadata"]>().mockResolvedValue(true),
    localBranchExists: vi
      .fn<TaskWorktreeGitAdapter["localBranchExists"]>()
      .mockResolvedValue(false),
    remoteBranchExists: vi
      .fn<TaskWorktreeGitAdapter["remoteBranchExists"]>()
      .mockResolvedValue(true),
    resolveDefaultBranchRef: vi
      .fn<TaskWorktreeGitAdapter["resolveDefaultBranchRef"]>()
      .mockResolvedValue("origin/main"),
    ...overrides,
  };
}

describe("task worktree execution collaborators", () => {
  test("creates a baseline report with empty collections", () => {
    expect(createTaskWorktreeReport("demo-workspace", "Feature / ABC", "/tmp/task")).toEqual({
      status: "ok",
      workspace: "demo-workspace",
      name: "Feature / ABC",
      root: "/tmp/task",
      repositories: [],
      issues: [],
    });
  });

  test("creates dry-run repository entries with sanitized branch names", () => {
    const repositories = createDryRunTaskRepositories({
      branchPrefix: "Task",
      repositories: [createRepositoryFixture({ name: "repo_api" })],
      taskName: "---Feature / ABC---",
      taskRoot: "/tmp/worktrees/feature-abc",
    });

    expect(repositories).toEqual([
      {
        branch: "task/feature-abc/repo_api",
        name: "repo_api",
        path: "/tmp/worktrees/feature-abc/repos/repo_api",
        status: "created",
      },
    ]);
  });

  test("rejects dry-run repository paths that escape the task root", () => {
    expect(() =>
      createDryRunTaskRepositories({
        branchPrefix: "task",
        repositories: [createRepositoryFixture({ name: "../../evil" })],
        taskName: "Feature / ABC",
        taskRoot: "/tmp/worktrees/feature-abc",
      }),
    ).toThrow("task repository path escapes");
  });

  test("uses a git worktree for the task root when the workspace has git metadata", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-task-root-git-");
    const taskRoot = path.join(workspaceRoot, ".maestro", "worktrees", "feature-abc");
    const ensureWorktree = vi
      .fn<TaskWorktreeGitAdapter["ensureWorktree"]>()
      .mockResolvedValue("created");
    const hasGitMetadata = vi
      .fn<TaskWorktreeGitAdapter["hasGitMetadata"]>()
      .mockResolvedValue(true);
    const gitAdapter = createTaskWorktreeGitAdapterFixture({ ensureWorktree, hasGitMetadata });

    const issue = await prepareTaskWorkspaceRoot({
      branchPrefix: "task",
      gitAdapter,
      taskName: "Feature / ABC",
      taskRoot,
      workspaceName: "demo-workspace",
      workspaceRoot,
    });

    expect(issue).toBeUndefined();
    expect(gitAdapter.hasGitMetadata).toHaveBeenCalledWith(workspaceRoot);
    expect(gitAdapter.ensureWorktree).toHaveBeenCalledWith(
      workspaceRoot,
      taskRoot,
      "task/feature-abc/demo-workspace",
      "origin/main",
    );
  });

  test("returns an explicit warning and creates the task root when workspace git metadata is missing", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-task-root-no-git-");
    const taskRoot = path.join(workspaceRoot, ".maestro", "worktrees", "feature-abc");
    const ensureWorktree = vi
      .fn<TaskWorktreeGitAdapter["ensureWorktree"]>()
      .mockResolvedValue("created");
    const hasGitMetadata = vi
      .fn<TaskWorktreeGitAdapter["hasGitMetadata"]>()
      .mockResolvedValue(false);
    const gitAdapter = createTaskWorktreeGitAdapterFixture({ ensureWorktree, hasGitMetadata });

    const issue = await prepareTaskWorkspaceRoot({
      branchPrefix: "task",
      gitAdapter,
      taskName: "Feature / ABC",
      taskRoot,
      workspaceName: "demo-workspace",
      workspaceRoot,
    });

    expect(issue).toMatchObject({
      code: "WORKSPACE_GIT_MISSING",
      path: workspaceRoot,
    });
    expect(gitAdapter.ensureWorktree).not.toHaveBeenCalled();
    expect(existsSync(taskRoot)).toBe(true);
  });

  test("prepares repository worktrees and reports missing repositories", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-task-repos-");
    const taskRoot = path.join(workspaceRoot, ".maestro", "worktrees", "feature-abc");
    const repositories = [
      createRepositoryFixture({ name: "frontend" }),
      createRepositoryFixture({ name: "backend" }),
    ];
    const ensureWorktree = vi
      .fn<TaskWorktreeGitAdapter["ensureWorktree"]>()
      .mockResolvedValue("reused");
    const hasGitMetadata = vi.fn<TaskWorktreeGitAdapter["hasGitMetadata"]>(
      async (candidate: string) => candidate.endsWith("/frontend"),
    );
    const gitAdapter = createTaskWorktreeGitAdapterFixture({ ensureWorktree, hasGitMetadata });

    const outcomes = await prepareTaskRepositories({
      branchPrefix: "task",
      concurrencyLimit: 2,
      gitAdapter,
      repositories,
      taskName: "Feature / ABC",
      taskRoot,
      workspaceRoot,
    });

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]?.repository).toEqual({
      branch: "task/feature-abc/frontend",
      name: "frontend",
      path: path.join(taskRoot, "repos", "frontend"),
      status: "reused",
    });
    expect(outcomes[1]?.issue).toMatchObject({
      code: "REPO_MISSING",
      message: "Repository not installed: backend",
      path: path.join(workspaceRoot, "repos", "backend"),
    });
    expect(gitAdapter.ensureWorktree).toHaveBeenCalledTimes(1);
  });

  test("rejects repository names that escape the workspace root during worktree preparation", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-task-repo-escape-");
    const taskRoot = path.join(workspaceRoot, ".maestro", "worktrees", "feature-abc");
    const repositories = [createRepositoryFixture({ name: "../../evil" })];
    const ensureWorktree = vi
      .fn<TaskWorktreeGitAdapter["ensureWorktree"]>()
      .mockResolvedValue("reused");
    const hasGitMetadata = vi
      .fn<TaskWorktreeGitAdapter["hasGitMetadata"]>()
      .mockResolvedValue(true);
    const gitAdapter = createTaskWorktreeGitAdapterFixture({ ensureWorktree, hasGitMetadata });

    await expect(
      prepareTaskRepositories({
        branchPrefix: "task",
        concurrencyLimit: 2,
        gitAdapter,
        repositories,
        taskName: "Feature / ABC",
        taskRoot,
        workspaceRoot,
      }),
    ).rejects.toThrow("workspace repository path escapes");

    expect(gitAdapter.hasGitMetadata).not.toHaveBeenCalled();
    expect(gitAdapter.ensureWorktree).not.toHaveBeenCalled();
  });

  describe("repository base refs", () => {
    async function prepareOne(gitAdapter: TaskWorktreeGitAdapter, offline = false) {
      const workspaceRoot = await createManagedTempDir("maestro-task-base-");
      const outcomes = await prepareTaskRepositories({
        branchPrefix: "task",
        concurrencyLimit: 1,
        gitAdapter,
        offline,
        repositories: [createRepositoryFixture({ name: "foods" })],
        taskName: "t",
        taskRoot: path.join(workspaceRoot, "worktrees", "t"),
        workspaceRoot,
      });
      return { outcome: outcomes[0], sourceRepoRoot: path.join(workspaceRoot, "repos", "foods") };
    }

    const hasSourceOnly = vi.fn<TaskWorktreeGitAdapter["hasGitMetadata"]>(
      async (candidate) => !candidate.includes(path.join("worktrees", "t")),
    );

    test("fetches the reference branch and bases a new task branch on origin", async () => {
      const gitAdapter = createTaskWorktreeGitAdapterFixture({ hasGitMetadata: hasSourceOnly });

      const { outcome, sourceRepoRoot } = await prepareOne(gitAdapter);

      expect(gitAdapter.fetchBranch).toHaveBeenCalledWith(sourceRepoRoot, "main");
      expect(gitAdapter.ensureWorktree).toHaveBeenCalledWith(
        sourceRepoRoot,
        expect.any(String),
        "task/t/foods",
        "origin/main",
      );
      expect(outcome?.issue).toBeUndefined();
    });

    test("keeps the local reference branch and warns when the fetch fails", async () => {
      const gitAdapter = createTaskWorktreeGitAdapterFixture({
        fetchBranch: vi
          .fn<TaskWorktreeGitAdapter["fetchBranch"]>()
          .mockRejectedValue(new Error("network down")),
        hasGitMetadata: hasSourceOnly,
      });

      const { outcome } = await prepareOne(gitAdapter);

      expect(outcome?.issue).toMatchObject({ code: "FETCH_FAILED" });
      expect(outcome?.issue?.message).toContain("network down");
      expect(outcome?.repository?.status).toBe("created");
      expect(gitAdapter.ensureWorktree).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        "task/t/foods",
        "main",
      );
    });

    test("does not fetch when offline", async () => {
      const gitAdapter = createTaskWorktreeGitAdapterFixture({ hasGitMetadata: hasSourceOnly });

      await prepareOne(gitAdapter, true);

      expect(gitAdapter.fetchBranch).not.toHaveBeenCalled();
    });

    test("does not fetch for an existing task branch", async () => {
      const gitAdapter = createTaskWorktreeGitAdapterFixture({
        hasGitMetadata: hasSourceOnly,
        localBranchExists: vi
          .fn<TaskWorktreeGitAdapter["localBranchExists"]>()
          .mockResolvedValue(true),
      });

      await prepareOne(gitAdapter);

      expect(gitAdapter.fetchBranch).not.toHaveBeenCalled();
    });
  });

  test("merges repository outcomes into a task worktree report", () => {
    const report = createTaskWorktreeReport("demo-workspace", "Task", "/tmp/task");
    const outcomes = [
      {
        repository: {
          branch: "task/task/frontend",
          name: "frontend",
          path: "/tmp/task/repos/frontend",
          status: "created" as const,
        },
      },
      {
        issue: {
          code: "REPO_MISSING",
          message: "Repository not installed: backend",
          path: "/tmp/workspace/repos/backend",
        },
      },
    ];

    mergeTaskRepositoryOutcomes(report, outcomes);

    expect(report.repositories).toHaveLength(1);
    expect(report.issues).toHaveLength(1);
  });

  test("exposes the disabled-worktrees issue factory", () => {
    expect(createWorktreesDisabledIssue()).toEqual({
      code: "WORKTREES_DISABLED",
      message: "Task worktrees are disabled in spec.execution.worktrees.",
    });
  });
});
