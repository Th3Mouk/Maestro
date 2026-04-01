import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { doctorWorkspace } from "../../src/core/commands/workspace-doctor.js";
import { readText } from "../../src/utils/fs.js";
import { runPackHooks } from "../../src/core/commands/pack-hooks.js";
import { resolveWorkspace, discoverSparsePaths } from "../../src/core/workspace-service.js";
import {
  createResolvedWorkspaceFixture,
  createRepositoryFixture,
} from "../utils/execution-fixtures.js";
import { createCommandContextFixture } from "../utils/test-doubles.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

function mockFn<T extends (...args: any[]) => any = (...args: any[]) => any>() {
  return vi.fn<T>();
}

vi.mock("../../src/core/workspace-service.js", () => ({
  discoverSparsePaths: mockFn(),
  resolveWorkspace: mockFn(),
}));

vi.mock("../../src/core/commands/pack-hooks.js", () => ({
  runPackHooks: mockFn(),
}));

const mockedResolveWorkspace = vi.mocked(resolveWorkspace);
const mockedDiscoverSparsePaths = vi.mocked(discoverSparsePaths);
const mockedRunPackHooks = vi.mocked(runPackHooks);

beforeEach(() => {
  vi.resetAllMocks();
  mockedDiscoverSparsePaths.mockResolvedValue([]);
  mockedRunPackHooks.mockResolvedValue([]);
});

describe("workspace doctor", () => {
  test("keeps issue semantics and persists the doctor report", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-workspace-doctor-");
    await mkdir(path.join(workspaceRoot, ".maestro"), { recursive: true });
    await mkdir(path.join(workspaceRoot, ".agents", "plugins"), { recursive: true });

    await writeFile(path.join(workspaceRoot, ".maestro", "lock.json"), "{}\n", "utf8");
    await writeFile(path.join(workspaceRoot, ".maestro", "state.json"), "{}\n", "utf8");
    await writeFile(path.join(workspaceRoot, "maestro.json"), "{}\n", "utf8");
    await writeFile(
      path.join(workspaceRoot, ".agents", "plugins", "marketplace.json"),
      JSON.stringify({
        plugins: [
          {
            name: "local-plugin",
            source: {
              source: "local",
              path: "plugins/local-plugin",
            },
          },
        ],
      }),
      "utf8",
    );

    mockedResolveWorkspace.mockResolvedValue(
      createResolvedWorkspaceFixture({
        execution: {
          devcontainer: { enabled: true },
          worktrees: { enabled: true },
        },
        repositories: [
          createRepositoryFixture({
            branch: "main",
            name: "api",
            remote: "git@github.com:org/api.git",
            sparse: {
              includePaths: ["src/"],
              excludePaths: ["dist/"],
            },
          }),
        ],
        runtimes: {
          codex: { enabled: true },
          "claude-code": { enabled: true },
          opencode: { enabled: true },
        },
        workspaceName: "doctor-fixture",
      }),
    );
    mockedDiscoverSparsePaths.mockResolvedValue(["dist/"]);
    mockedRunPackHooks.mockResolvedValue([{ code: "PACK_HOOK_WARNING", message: "hook issue" }]);

    const report = await doctorWorkspace(
      workspaceRoot,
      createCommandContextFixture({
        gitAdapter: {
          getCurrentBranch: mockFn().mockResolvedValue("feature/refactor"),
          getRemoteUrl: mockFn().mockResolvedValue("git@github.com:org/other.git"),
          hasGitMetadata: mockFn().mockResolvedValue(true),
        },
      }),
    );

    expect(report.status).toBe("warning");
    expect(report.workspace).toBe("doctor-fixture");

    expect(report.issues.map((issue) => issue.code)).toEqual([
      "LOCKFILE_INVALID",
      "STATE_INVALID",
      "REMOTE_MISMATCH",
      "BRANCH_MISMATCH",
      "SPARSE_PATH_MISSING",
      "SPARSE_PATH_PRESENT",
      "RUNTIME_ARTIFACT_MISSING",
      "RUNTIME_ARTIFACT_MISSING",
      "RUNTIME_ARTIFACT_MISSING",
      "RUNTIME_ARTIFACT_MISSING",
      "PLUGIN_MANIFEST_MISSING",
      "EXECUTION_BOOTSTRAP_MISSING",
      "WORKSPACE_DESCRIPTOR_INVALID",
      "WORKTREE_CONFIG_MISSING",
      "DEVCONTAINER_ARTIFACT_MISSING",
      "DEVCONTAINER_ARTIFACT_MISSING",
      "DEVCONTAINER_ARTIFACT_MISSING",
      "PACK_HOOK_WARNING",
    ]);

    expect(report.issues[0]?.message).toContain("Lockfile content is invalid.");
    expect(report.issues[1]?.message).toContain("Workspace state content is invalid.");
    expect(report.issues[2]?.message).toBe("Remote differs for api");
    expect(report.issues[3]?.message).toBe(
      "Active branch is feature/refactor instead of reference branch main",
    );
    expect(report.issues[4]?.message).toBe("Sparse path is missing: src/");
    expect(report.issues[5]?.message).toBe("Sparse exclusion is still present: dist/");

    const persistedReportPath = path.join(
      workspaceRoot,
      ".maestro",
      "reports",
      "doctor-report.json",
    );
    expect(JSON.parse(await readText(persistedReportPath))).toEqual(report);
  });

  test("returns DOCTOR_FAILED and still persists a report when diagnostics crash", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-workspace-doctor-failed-");
    mockedResolveWorkspace.mockRejectedValue(new Error("diagnostics exploded"));

    const report = await doctorWorkspace(workspaceRoot, createCommandContextFixture());

    expect(report.status).toBe("error");
    expect(report.issues).toEqual([
      {
        code: "DOCTOR_FAILED",
        message: "Doctor command failed.: diagnostics exploded",
      },
    ]);

    const persistedReportPath = path.join(
      workspaceRoot,
      ".maestro",
      "reports",
      "doctor-report.json",
    );
    expect(JSON.parse(await readText(persistedReportPath))).toEqual(report);
  });
});
