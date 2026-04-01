import { beforeEach, describe, expect, test, vi } from "vitest";
import path from "node:path";
import { installWorkspace } from "../../src/core/commands/workspace-install.js";
import { resolveWorkspace, ensureWorkspaceSkeleton } from "../../src/core/workspace-service.js";
import { projectExecutionSupport } from "../../src/core/execution-service.js";
import { runPackHooks } from "../../src/core/commands/pack-hooks.js";
import { createBuiltInProjectors } from "../../src/adapters/runtimes/index.js";
import { createResolvedWorkspaceFixture } from "../utils/execution-fixtures.js";
import { createCommandContextFixture } from "../utils/test-doubles.js";
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
      createResolvedWorkspaceFixture({
        repositories: [
          {
            branch: "main",
            name: "sample",
            remote: "git@github.com:org/sample.git",
          },
        ],
      }),
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

    mockedResolveWorkspace.mockResolvedValue(createResolvedWorkspaceFixture({ repositories: [] }));

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

  test("rejects nested traversal repository names that escape the repos root", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-install-nested-repo-escape-");
    const escapedRepositoryName = "nested/../../../../evil-repo";

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

  test("rejects absolute report names that escape the reports root", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-install-absolute-report-escape-");

    mockedResolveWorkspace.mockResolvedValue(createResolvedWorkspaceFixture({ repositories: [] }));

    await expect(
      installWorkspace(
        workspaceRoot,
        {
          dryRun: true,
          reportName: path.resolve(workspaceRoot, "..", "outside-report.json"),
        },
        createCommandContextFixture({
          gitAdapter: { ensureRepository: mockFn() },
        }),
      ),
    ).rejects.toThrow("install report path escapes");
  });
});
