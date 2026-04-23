import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  createWorktreeRemoveReport,
  mergeRemoveRepositoryOutcomes,
  removeTaskRepositories,
  type TaskWorktreeRemoveGitAdapter,
} from "../../src/core/execution/task-worktree-removal.js";
import {
  listTaskWorktreesWithResolvedWorkspace,
  removeTaskWorktreeWithResolvedWorkspace,
} from "../../src/core/execution-support/task-worktree-remove.js";
import { listWorkspaceRepositoriesWithResolvedWorkspace } from "../../src/core/execution-support/repository-list.js";
import { pathExists } from "../../src/utils/fs.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";
import {
  createRepositoryFixture,
  createResolvedWorkspaceFixture,
} from "../utils/execution-fixtures.js";

function createRemoveGitAdapterFixture(
  overrides: Partial<TaskWorktreeRemoveGitAdapter> = {},
): TaskWorktreeRemoveGitAdapter {
  return {
    hasGitMetadata: vi.fn().mockResolvedValue(true),
    removeWorktree: vi.fn().mockResolvedValue("removed"),
    ...overrides,
  };
}

describe("createWorktreeRemoveReport", () => {
  test("returns a pristine ok report with empty repositories and issues", () => {
    const report = createWorktreeRemoveReport("ws", "fix-bug", "/tmp/task");
    expect(report).toEqual({
      status: "ok",
      workspace: "ws",
      name: "fix-bug",
      root: "/tmp/task",
      repositories: [],
      workspaceRootStatus: "skipped",
      issues: [],
    });
  });
});

describe("removeTaskRepositories orchestrator", () => {
  test("marks repository skipped and emits REPO_MISSING issue when source is not installed", async () => {
    const gitAdapter = createRemoveGitAdapterFixture({
      hasGitMetadata: vi.fn().mockResolvedValue(false),
    });
    const outcomes = await removeTaskRepositories({
      concurrencyLimit: 2,
      force: false,
      gitAdapter,
      repositories: [createRepositoryFixture({ name: "frontend" })],
      taskRoot: "/tmp/ws/.maestro/worktrees/task",
      workspaceRoot: "/tmp/ws",
    });

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]?.repository.status).toBe("skipped");
    expect(outcomes[0]?.issue?.code).toBe("REPO_MISSING");
    expect(gitAdapter.removeWorktree).not.toHaveBeenCalled();
  });

  test("captures per-repo failures without aborting siblings", async () => {
    const removeWorktree = vi
      .fn()
      .mockImplementationOnce(async () => {
        throw new Error("boom");
      })
      .mockResolvedValueOnce("removed");
    const gitAdapter = createRemoveGitAdapterFixture({ removeWorktree });

    const outcomes = await removeTaskRepositories({
      concurrencyLimit: 1,
      force: true,
      gitAdapter,
      repositories: [
        createRepositoryFixture({ name: "a" }),
        createRepositoryFixture({ name: "b" }),
      ],
      taskRoot: "/tmp/ws/.maestro/worktrees/task",
      workspaceRoot: "/tmp/ws",
    });

    expect(outcomes).toHaveLength(2);
    expect(outcomes[0]?.repository.status).toBe("failed");
    expect(outcomes[0]?.repository.message).toBe("boom");
    expect(outcomes[0]?.issue?.code).toBe("WORKTREE_REMOVE_FAILED");
    expect(outcomes[1]?.repository.status).toBe("removed");
    expect(outcomes[1]?.issue).toBeUndefined();
    // force flag is forwarded
    expect(removeWorktree).toHaveBeenCalledWith(expect.any(String), expect.any(String), {
      force: true,
    });
  });

  test("passes removed status from adapter for healthy repos", async () => {
    const gitAdapter = createRemoveGitAdapterFixture({
      removeWorktree: vi.fn().mockResolvedValue("missing"),
    });
    const outcomes = await removeTaskRepositories({
      concurrencyLimit: 2,
      force: false,
      gitAdapter,
      repositories: [createRepositoryFixture({ name: "svc" })],
      taskRoot: "/tmp/ws/.maestro/worktrees/task",
      workspaceRoot: "/tmp/ws",
    });
    expect(outcomes[0]?.repository.status).toBe("missing");
    expect(outcomes[0]?.issue).toBeUndefined();
  });
});

describe("mergeRemoveRepositoryOutcomes", () => {
  test("appends repositories and issues into the report", () => {
    const report = createWorktreeRemoveReport("ws", "task", "/tmp/task");
    mergeRemoveRepositoryOutcomes(report, [
      {
        repository: { name: "a", path: "/tmp/task/repos/a", status: "removed" },
      },
      {
        repository: {
          name: "b",
          path: "/tmp/task/repos/b",
          status: "failed",
          message: "nope",
        },
        issue: { code: "WORKTREE_REMOVE_FAILED", message: "x", path: "/tmp/task/repos/b" },
      },
    ]);

    expect(report.repositories).toHaveLength(2);
    expect(report.repositories[1]?.message).toBe("nope");
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]?.code).toBe("WORKTREE_REMOVE_FAILED");
  });
});

describe("removeTaskWorktreeWithResolvedWorkspace", () => {
  test("returns warning status with WORKTREE_NOT_FOUND when task root is missing", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-remove-missing-");
    const resolvedWorkspace = createResolvedWorkspaceFixture({
      repositories: [createRepositoryFixture({ name: "frontend" })],
      workspaceName: "ws",
    });
    const gitAdapter = createRemoveGitAdapterFixture();

    const report = await removeTaskWorktreeWithResolvedWorkspace(
      workspaceRoot,
      resolvedWorkspace,
      "missing-task",
      {},
      { gitAdapter },
      2,
    );

    expect(report.status).toBe("warning");
    expect(report.issues[0]?.code).toBe("WORKTREE_NOT_FOUND");
    expect(gitAdapter.hasGitMetadata).not.toHaveBeenCalled();
    expect(gitAdapter.removeWorktree).not.toHaveBeenCalled();
  });

  test("dry-run reports all repositories as removed without invoking git", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-remove-dryrun-");
    const taskRoot = path.join(workspaceRoot, ".maestro", "worktrees", "my-task");
    await mkdir(taskRoot, { recursive: true });

    const resolvedWorkspace = createResolvedWorkspaceFixture({
      repositories: [
        createRepositoryFixture({ name: "frontend" }),
        createRepositoryFixture({ name: "backend" }),
      ],
      workspaceName: "ws",
    });
    const gitAdapter = createRemoveGitAdapterFixture();

    const report = await removeTaskWorktreeWithResolvedWorkspace(
      workspaceRoot,
      resolvedWorkspace,
      "my-task",
      { dryRun: true },
      { gitAdapter },
      2,
    );

    expect(report.status).toBe("ok");
    expect(report.repositories.map((r) => r.name)).toEqual(["frontend", "backend"]);
    expect(report.repositories.every((r) => r.status === "removed")).toBe(true);
    expect(report.workspaceRootStatus).toBe("removed");
    expect(gitAdapter.hasGitMetadata).not.toHaveBeenCalled();
    expect(gitAdapter.removeWorktree).not.toHaveBeenCalled();
  });

  test("happy path removes per-repo worktrees, workspace-root worktree, and task root", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-remove-happy-");
    const taskRoot = path.join(workspaceRoot, ".maestro", "worktrees", "my-task");
    await mkdir(path.join(taskRoot, "repos", "frontend"), { recursive: true });

    const resolvedWorkspace = createResolvedWorkspaceFixture({
      repositories: [createRepositoryFixture({ name: "frontend" })],
      workspaceName: "ws",
    });

    const removeWorktree = vi.fn().mockResolvedValue("removed");
    const gitAdapter = createRemoveGitAdapterFixture({
      hasGitMetadata: vi.fn().mockResolvedValue(true),
      removeWorktree,
    });

    const report = await removeTaskWorktreeWithResolvedWorkspace(
      workspaceRoot,
      resolvedWorkspace,
      "my-task",
      { force: true },
      { gitAdapter },
      2,
    );

    expect(report.status).toBe("ok");
    expect(report.repositories).toEqual([
      expect.objectContaining({ name: "frontend", status: "removed" }),
    ]);
    expect(report.workspaceRootStatus).toBe("removed");
    // One per-repo call + one workspace-root call
    expect(removeWorktree).toHaveBeenCalledTimes(2);
    expect(removeWorktree).toHaveBeenCalledWith(
      expect.stringContaining(path.join("repos", "frontend")),
      expect.stringContaining(path.join("my-task", "repos", "frontend")),
      { force: true },
    );
    expect(removeWorktree).toHaveBeenLastCalledWith(workspaceRoot, taskRoot, { force: true });
    expect(await pathExists(taskRoot)).toBe(false);
  });

  test("workspace-root removal marked missing when task root has no git metadata", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-remove-no-meta-");
    const taskRoot = path.join(workspaceRoot, ".maestro", "worktrees", "t");
    await mkdir(taskRoot, { recursive: true });

    const resolvedWorkspace = createResolvedWorkspaceFixture({
      repositories: [],
      workspaceName: "ws",
    });
    // First call: taskRoot metadata check -> false.
    const gitAdapter = createRemoveGitAdapterFixture({
      hasGitMetadata: vi.fn().mockResolvedValue(false),
    });

    const report = await removeTaskWorktreeWithResolvedWorkspace(
      workspaceRoot,
      resolvedWorkspace,
      "t",
      {},
      { gitAdapter },
      2,
    );

    expect(report.workspaceRootStatus).toBe("missing");
    expect(gitAdapter.removeWorktree).not.toHaveBeenCalled();
    expect(await pathExists(taskRoot)).toBe(false);
  });
});

describe("listTaskWorktreesWithResolvedWorkspace", () => {
  test("returns empty ok report when worktrees root does not exist", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-list-empty-");
    const resolvedWorkspace = createResolvedWorkspaceFixture({
      repositories: [],
      workspaceName: "ws",
    });

    const report = await listTaskWorktreesWithResolvedWorkspace(workspaceRoot, resolvedWorkspace);
    expect(report).toEqual({
      status: "ok",
      workspace: "ws",
      worktrees: [],
      issues: [],
    });
  });

  test("returns populated report with metadata, warns when metadata missing", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-list-populated-");
    const worktreesRoot = path.join(workspaceRoot, ".maestro", "worktrees");

    // Worktree A with valid metadata
    const aRoot = path.join(worktreesRoot, "task-a");
    await mkdir(path.join(aRoot, ".maestro", "execution"), { recursive: true });
    await writeFile(
      path.join(aRoot, ".maestro", "execution", "worktree.json"),
      JSON.stringify({ name: "task-a", createdAt: "2026-01-01T00:00:00.000Z" }),
    );

    // Worktree B without metadata
    const bRoot = path.join(worktreesRoot, "task-b");
    await mkdir(bRoot, { recursive: true });

    const resolvedWorkspace = createResolvedWorkspaceFixture({
      repositories: [],
      workspaceName: "ws",
    });

    const report = await listTaskWorktreesWithResolvedWorkspace(workspaceRoot, resolvedWorkspace);

    expect(report.status).toBe("warning");
    expect(report.worktrees).toHaveLength(2);
    const a = report.worktrees.find((w) => w.name === "task-a");
    expect(a).toMatchObject({ name: "task-a", createdAt: "2026-01-01T00:00:00.000Z", root: aRoot });
    const b = report.worktrees.find((w) => w.name === "task-b");
    expect(b).toMatchObject({ name: "task-b", createdAt: "", root: bRoot });
    expect(report.issues[0]?.code).toBe("WORKTREE_METADATA_MISSING");
  });
});

describe("listWorkspaceRepositoriesWithResolvedWorkspace", () => {
  test("reports installed=true for repos with .git and installed=false otherwise", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-list-repos-");

    // frontend: installed
    await mkdir(path.join(workspaceRoot, "repos", "frontend", ".git"), { recursive: true });
    // backend: directory exists but no .git
    await mkdir(path.join(workspaceRoot, "repos", "backend"), { recursive: true });
    // ghost: nothing on disk

    const resolvedWorkspace = createResolvedWorkspaceFixture({
      repositories: [
        createRepositoryFixture({ name: "frontend", branch: "develop" }),
        createRepositoryFixture({ name: "backend" }),
        createRepositoryFixture({ name: "ghost" }),
      ],
      workspaceName: "ws",
    });

    const report = await listWorkspaceRepositoriesWithResolvedWorkspace(
      workspaceRoot,
      resolvedWorkspace,
    );

    expect(report.status).toBe("ok");
    expect(report.issues).toEqual([]);
    expect(report.repositories).toHaveLength(3);
    const frontend = report.repositories.find((r) => r.name === "frontend");
    expect(frontend).toMatchObject({
      branch: "develop",
      installed: true,
      remote: "git@github.com:org/frontend.git",
      path: path.join(workspaceRoot, "repos", "frontend"),
    });
    expect(report.repositories.find((r) => r.name === "backend")?.installed).toBe(false);
    expect(report.repositories.find((r) => r.name === "ghost")?.installed).toBe(false);
  });

  test("defaults missing branch to 'main'", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-list-repos-default-");
    const resolvedWorkspace = createResolvedWorkspaceFixture({
      repositories: [{ name: "svc", remote: "git@github.com:org/svc.git", branch: "main", sparse: { visiblePaths: ["."] } }],
      workspaceName: "ws",
    });

    const report = await listWorkspaceRepositoriesWithResolvedWorkspace(
      workspaceRoot,
      resolvedWorkspace,
    );
    expect(report.repositories[0]?.branch).toBe("main");
  });
});
