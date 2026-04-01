import path from "node:path";
import { readFile } from "node:fs/promises";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  checkoutWorkspaceGitBranches,
  pullWorkspaceGitBranches,
  syncWorkspaceGitBranches,
} from "../../src/core/commands/workspace-git.js";
import { resolveWorkspace } from "../../src/core/workspace-service.js";
import { workspaceStateDirName } from "../../src/workspace/state-directory.js";
import {
  createResolvedWorkspaceFixture,
  createRepositoryFixture,
} from "../utils/execution-fixtures.js";
import { createCommandContextFixture, mockFn } from "../utils/test-doubles.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

vi.mock("../../src/core/workspace-service.js", () => ({
  resolveWorkspace: vi.fn<() => Promise<unknown>>(),
}));

const mockedResolveWorkspace = vi.mocked(resolveWorkspace);

afterEach(() => {
  vi.clearAllMocks();
});

describe("workspace git command", () => {
  test("checkout reports missing repositories and persists report under workspace state", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-workspace-git-checkout-");
    mockedResolveWorkspace.mockResolvedValue(
      createResolvedWorkspaceFixture({
        workspaceName: "ops-workspace",
        repositories: [createRepositoryFixture({ name: "sur-api", branch: "develop" })],
      }),
    );

    const report = await checkoutWorkspaceGitBranches(
      workspaceRoot,
      createCommandContextFixture({
        gitAdapter: {
          hasGitMetadata: mockFn().mockResolvedValue(false),
        },
      }),
    );

    expect(report.status).toBe("warning");
    expect(report.workspace).toBe("ops-workspace");
    expect(report.command).toBe("checkout");
    expect(report.repositories).toStrictEqual([
      {
        name: "sur-api",
        path: path.join(workspaceRoot, "repos", "sur-api"),
        branch: "develop",
        status: "failed",
        message: "Repository not installed.",
      },
    ]);
    expect(report.issues).toStrictEqual([
      {
        code: "REPO_MISSING",
        message: "Repository not installed: sur-api",
        path: path.join(workspaceRoot, "repos", "sur-api"),
      },
    ]);

    const reportPath = path.join(
      workspaceRoot,
      workspaceStateDirName,
      "reports",
      "git-checkout-report.json",
    );
    const persisted = JSON.parse(await readFile(reportPath, "utf8"));
    expect(persisted).toStrictEqual(report);
  });

  test("sync surfaces checkout failures as pull failures and skips pull on that repository", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-workspace-git-sync-");
    mockedResolveWorkspace.mockResolvedValue(
      createResolvedWorkspaceFixture({
        repositories: [createRepositoryFixture({ name: "sur-api" })],
      }),
    );

    const pullCurrentBranch = mockFn().mockResolvedValue({ branch: "main", status: "updated" });
    const context = createCommandContextFixture({
      gitAdapter: {
        hasGitMetadata: mockFn().mockResolvedValue(true),
        checkoutBranch: mockFn().mockRejectedValue(new Error("dirty working tree")),
        pullCurrentBranch,
        getCurrentBranch: mockFn().mockResolvedValue("feature/local"),
      },
    });

    const report = await syncWorkspaceGitBranches(workspaceRoot, context);

    expect(report.status).toBe("warning");
    expect(report.command).toBe("sync");
    expect(report.repositories[0]?.status).toBe("failed");
    expect(report.repositories[0]?.branch).toBe("feature/local");
    expect(report.repositories[0]?.message).toContain("sur-api sync failed");
    expect(report.repositories[0]?.message).toContain("dirty working tree");
    expect(report.issues[0]?.code).toBe("GIT_PULL_FAILED");
    expect(report.issues[0]?.message).toContain("sur-api:");
    expect(pullCurrentBranch).not.toHaveBeenCalled();
  });

  test("handles workspace-level failures with WORKSPACE_GIT_COMMAND_FAILED", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-workspace-git-failure-");
    mockedResolveWorkspace.mockRejectedValue(new Error("workspace unavailable"));

    const report = await pullWorkspaceGitBranches(workspaceRoot, createCommandContextFixture());

    expect(report.status).toBe("error");
    expect(report.command).toBe("pull");
    expect(report.repositories).toStrictEqual([]);
    expect(report.issues).toStrictEqual([
      {
        code: "WORKSPACE_GIT_COMMAND_FAILED",
        message: "Workspace git pull failed: workspace unavailable",
      },
    ]);
  });
});
