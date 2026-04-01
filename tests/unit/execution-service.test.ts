import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { execa } from "execa";
import {
  bootstrapWorkspace,
  projectEditorWorkspace,
  projectExecutionSupport,
  prepareTaskWorktree,
  type ExecutionGitAdapter,
} from "../../src/core/execution-service.js";
import { initWorkspace } from "../../src/core/commands/workspace-init.js";
import { resolveWorkspace } from "../../src/core/workspace-service.js";
import {
  createExecaResultFixture,
  createRepositoryFixture,
  createResolvedWorkspaceFixture,
  createRuntimeFixture,
} from "../utils/execution-fixtures.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

function mockFn<T extends (...args: any[]) => any = (...args: any[]) => any>() {
  return vi.fn<T>();
}

vi.mock("execa", () => ({
  execa: mockFn(),
}));

vi.mock(import("../../src/core/workspace-service.js"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveWorkspace: mockFn(),
  };
});

const mockedExeca = vi.mocked(execa);
const mockedResolveWorkspace = vi.mocked(resolveWorkspace);

afterEach(() => {
  vi.useRealTimers();
});

describe("execution service", () => {
  test("surfaces actionable underlying bootstrap command errors", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-bootstrap-error-");

    mockedResolveWorkspace.mockResolvedValue(
      createResolvedWorkspaceFixture({
        repositories: [
          createRepositoryFixture({
            bootstrap: {
              commands: ["npm ci"],
              strategy: "manual",
            },
            name: "sur-api",
          }),
        ],
      }),
    );

    mockedExeca.mockRejectedValue(
      new Error("Process exited with code 127", {
        cause: new Error("npm: command not found"),
      }),
    );

    const report = await bootstrapWorkspace(workspaceRoot);

    expect(report.status).toBe("warning");
    expect(report.issues).toHaveLength(1);
    expect(report.issues[0]?.code).toBe("BOOTSTRAP_COMMAND_FAILED");
    expect(report.issues[0]?.message).toContain("Bootstrap command failed for sur-api");
    expect(report.issues[0]?.message).toContain("command: npm ci");
    expect(report.issues[0]?.message).toContain("npm: command not found");
  });

  test("keeps bootstrap repository report order deterministic under parallel execution", async () => {
    vi.useFakeTimers();

    const workspaceRoot = await createManagedTempDir("maestro-bootstrap-order-");

    mockedResolveWorkspace.mockResolvedValue(
      createResolvedWorkspaceFixture({
        repositories: [
          createRepositoryFixture({
            bootstrap: {
              commands: ["sleep-a"],
              strategy: "manual",
            },
            name: "repo-a",
          }),
          createRepositoryFixture({
            bootstrap: {
              commands: ["sleep-b"],
              strategy: "manual",
            },
            name: "repo-b",
          }),
        ],
      }),
    );

    mockedExeca.mockImplementation((...args: unknown[]) => {
      const commandArgs = Array.isArray(args[1]) ? args[1] : [];
      if (commandArgs[2] === "sleep-a") {
        return (async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return createExecaResultFixture();
        })() as unknown as ReturnType<typeof execa>;
      }
      return Promise.resolve(createExecaResultFixture()) as unknown as ReturnType<typeof execa>;
    });

    const reportPromise = bootstrapWorkspace(workspaceRoot);
    await vi.advanceTimersByTimeAsync(20);
    const report = await reportPromise;

    expect(report.repositories.map((entry) => entry.name)).toEqual(["repo-a", "repo-b"]);
  });

  test("uses injected git adapter for task worktree creation", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-worktree-adapter-");

    mockedResolveWorkspace.mockResolvedValue(
      createResolvedWorkspaceFixture({
        execution: {
          devcontainer: { enabled: false },
          worktrees: {
            branchPrefix: "task",
            enabled: true,
            rootDir: ".maestro/worktrees",
          },
        },
      }),
    );

    const gitAdapter: ExecutionGitAdapter = {
      ensureWorktree: mockFn().mockResolvedValue("created"),
      hasGitMetadata: mockFn().mockResolvedValue(true),
    };

    const report = await prepareTaskWorktree(workspaceRoot, "Feature / ABC", {}, { gitAdapter });

    const expectedTaskRoot = path.join(workspaceRoot, ".maestro", "worktrees", "feature-abc");
    expect(report.status).toBe("ok");
    expect(report.root).toBe(expectedTaskRoot);
    expect(gitAdapter.hasGitMetadata).toHaveBeenCalledWith(workspaceRoot);
    expect(gitAdapter.ensureWorktree).toHaveBeenCalledWith(
      workspaceRoot,
      expectedTaskRoot,
      "task/feature-abc/demo-workspace",
      "HEAD",
    );
  });

  test("normalizes task names with repeated edge hyphens without changing the branch slug", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-worktree-hyphen-sanitizer-");

    mockedResolveWorkspace.mockResolvedValue(
      createResolvedWorkspaceFixture({
        execution: {
          devcontainer: { enabled: false },
          worktrees: {
            branchPrefix: "task",
            enabled: true,
            rootDir: ".maestro/worktrees",
          },
        },
      }),
    );

    const gitAdapter: ExecutionGitAdapter = {
      ensureWorktree: mockFn().mockResolvedValue("created"),
      hasGitMetadata: mockFn().mockResolvedValue(true),
    };

    const report = await prepareTaskWorktree(
      workspaceRoot,
      "---Feature / ABC---",
      {},
      { gitAdapter },
    );

    const expectedTaskRoot = path.join(workspaceRoot, ".maestro", "worktrees", "feature-abc");
    expect(report.status).toBe("ok");
    expect(report.root).toBe(expectedTaskRoot);
    expect(gitAdapter.ensureWorktree).toHaveBeenCalledWith(
      workspaceRoot,
      expectedTaskRoot,
      "task/feature-abc/demo-workspace",
      "HEAD",
    );
  });

  test("projectExecutionSupport does not create the optional editor workspace file", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-editor-workspace-");

    await projectExecutionSupport(
      workspaceRoot,
      createResolvedWorkspaceFixture({
        repositories: [
          createRepositoryFixture({
            name: "frontend",
            sparse: {
              visiblePaths: ["package.json"],
            },
          }),
          createRepositoryFixture({
            name: "backend",
            sparse: {
              visiblePaths: ["composer.json"],
            },
          }),
        ],
      }),
    );

    expect(existsSync(path.join(workspaceRoot, "maestro.code-workspace"))).toBe(false);
  });

  test("projects a multi-root editor workspace file on demand", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-editor-workspace-");

    mockedResolveWorkspace.mockResolvedValue(
      createResolvedWorkspaceFixture({
        repositories: [
          createRepositoryFixture({
            name: "frontend",
            sparse: {
              visiblePaths: ["package.json"],
            },
          }),
          createRepositoryFixture({
            name: "backend",
            sparse: {
              visiblePaths: ["composer.json"],
            },
          }),
        ],
      }),
    );

    await projectEditorWorkspace(workspaceRoot);

    const editorWorkspace = JSON.parse(
      await readFile(path.join(workspaceRoot, "maestro.code-workspace"), "utf8"),
    ) as {
      folders: Array<{ name: string; path: string }>;
      settings: { "files.exclude": Record<string, boolean> };
    };

    expect(editorWorkspace.folders).toEqual([
      {
        name: "demo-workspace",
        path: ".",
      },
      {
        name: "frontend",
        path: "repos/frontend",
      },
      {
        name: "backend",
        path: "repos/backend",
      },
    ]);
    expect(editorWorkspace.settings["files.exclude"]).toEqual({
      repos: true,
      ".maestro/worktrees": true,
    });
  });

  test("projects a neutral workspace descriptor for agents and harnesses", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-workspace-descriptor-");

    await projectExecutionSupport(
      workspaceRoot,
      createResolvedWorkspaceFixture({
        repositories: [
          createRepositoryFixture({
            name: "frontend",
            sparse: {
              visiblePaths: ["package.json"],
            },
          }),
        ],
      }),
    );

    const descriptor = JSON.parse(
      await readFile(path.join(workspaceRoot, "maestro.json"), "utf8"),
    ) as {
      schemaVersion: string;
      workspace: {
        name: string;
        root: string;
        manifest: string;
        agentsFile: string;
      };
      layout: {
        repositoriesRoot: string;
        worktreesRoot: string | null;
      };
      repositories: Array<{
        name: string;
        path: string;
        remote: string;
        referenceBranch: string;
        sparsePaths: string[];
      }>;
      projections: {
        runtimes: string[];
        devcontainer: string | null;
      };
    };

    expect(descriptor.schemaVersion).toBe("maestro.workspace/v1");
    expect(descriptor.workspace).toEqual({
      name: "demo-workspace",
      root: ".",
      manifest: "maestro.yaml",
      agentsFile: "AGENTS.md",
    });
    expect(descriptor.layout).toEqual({
      repositoriesRoot: "repos",
      worktreesRoot: ".maestro/worktrees",
    });
    expect(descriptor.repositories).toEqual([
      {
        name: "frontend",
        path: "repos/frontend",
        remote: "git@github.com:org/frontend.git",
        referenceBranch: "main",
        sparsePaths: ["package.json"],
      },
    ]);
    expect(descriptor.projections).toEqual({
      runtimes: [],
      devcontainer: null,
    });
  });

  test("keeps the scaffold-time and install-time workspace descriptors aligned", async () => {
    const initParent = await createManagedTempDir("maestro-init-descriptor-parity-");
    const initWorkspaceRoot = path.join(initParent, "demo-workspace");
    const projectedWorkspaceRoot = await createManagedTempDir("maestro-project-descriptor-parity-");

    await initWorkspace(initWorkspaceRoot);

    await projectExecutionSupport(
      projectedWorkspaceRoot,
      createResolvedWorkspaceFixture({
        repositories: [],
        runtimes: createRuntimeFixture({
          codex: {
            enabled: true,
            installProjectConfig: true,
            installAgents: true,
            useAgentsFile: "AGENTS.md",
          },
          "claude-code": {
            enabled: true,
            installProjectInstructions: true,
            instructionsFile: "CLAUDE.md",
          },
        }),
        workspaceName: "demo-workspace",
      }),
    );

    const scaffoldDescriptor = JSON.parse(
      await readFile(path.join(initWorkspaceRoot, "maestro.json"), "utf8"),
    );
    const projectedDescriptor = JSON.parse(
      await readFile(path.join(projectedWorkspaceRoot, "maestro.json"), "utf8"),
    );

    expect(projectedDescriptor).toEqual(scaffoldDescriptor);
  });

  test("rejects repository names that escape the workspace repos root", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-bootstrap-repo-escape-");

    mockedResolveWorkspace.mockResolvedValue(
      createResolvedWorkspaceFixture({
        repositories: [
          createRepositoryFixture({
            name: "../../evil",
            remote: "git@github.com:org/evil.git",
          }),
        ],
      }),
    );

    await expect(bootstrapWorkspace(workspaceRoot)).rejects.toThrow(
      "workspace repository path escapes",
    );
  });

  test("renders bootstrap script with quoted repository names", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-bootstrap-script-quote-");
    const repositoryName = "repo$(echo hacked)";

    await projectExecutionSupport(
      workspaceRoot,
      createResolvedWorkspaceFixture({
        execution: {
          devcontainer: {
            enabled: false,
          },
          worktrees: {
            enabled: false,
          },
        },
        repositories: [
          createRepositoryFixture({
            bootstrap: {
              commands: ["npm ci"],
              strategy: "manual",
            },
            name: repositoryName,
            remote: "git@github.com:org/sur-api.git",
          }),
        ],
      }),
      false,
    );

    const bootstrapScript = await readFile(
      path.join(workspaceRoot, ".maestro", "execution", "bootstrap.sh"),
      "utf8",
    );

    expect(bootstrapScript).toContain(`printf '%s\\n' '==> ${repositoryName}'`);
    expect(bootstrapScript).toContain(`(cd "$WORKSPACE_ROOT"/'repos/${repositoryName}' && npm ci)`);
  });
});
