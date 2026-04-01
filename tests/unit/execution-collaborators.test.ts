import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  buildBootstrapPlan,
  renderBootstrapScript,
  type RepositoryBootstrapPlan,
} from "../../src/core/execution/bootstrap-plan.js";
import {
  renderDevcontainerConfig,
  renderDevcontainerDockerfile,
} from "../../src/core/execution/devcontainer.js";
import { syncWorkspaceOverlay } from "../../src/core/execution/workspace-overlay.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";
import {
  createRepositoryFixture,
  createResolvedWorkspaceFixture,
} from "../utils/execution-fixtures.js";

function createBootstrapPlanEntry(
  overrides: Partial<RepositoryBootstrapPlan> &
    Pick<
      RepositoryBootstrapPlan,
      "commands" | "repository" | "repoPathFromWorkspaceRoot" | "skipped" | "toolchains"
    >,
): RepositoryBootstrapPlan {
  return {
    repoRoot: "/tmp/repo",
    ...overrides,
  };
}

describe("execution collaborators", () => {
  test("builds bootstrap plans from auto-detected and manual repositories", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-bootstrap-plan-");
    const autoRepoRoot = path.join(workspaceRoot, "repos", "frontend");
    await mkdir(autoRepoRoot, { recursive: true });
    await mkdir(path.join(workspaceRoot, "repos", "backend", "services"), { recursive: true });
    await writeFile(path.join(autoRepoRoot, "package.json"), "{}\n");
    await writeFile(path.join(autoRepoRoot, "pnpm-lock.yaml"), "lockfileVersion: '1'\n");

    const resolvedWorkspace = createResolvedWorkspaceFixture({
      repositories: [
        createRepositoryFixture({
          name: "frontend",
        }),
        createRepositoryFixture({
          bootstrap: {
            commands: ["echo manual"],
            enabled: true,
            strategy: "manual",
            workingDirectory: "services",
          },
          name: "backend",
        }),
      ],
    });

    const plan = await buildBootstrapPlan(workspaceRoot, resolvedWorkspace, 4);

    expect(plan).toHaveLength(2);
    expect(plan[0]).toMatchObject({
      commands: [
        "corepack enable >/dev/null 2>&1 || true; pnpm install --frozen-lockfile || pnpm install",
      ],
      repoPathFromWorkspaceRoot: "repos/frontend",
      skipped: false,
      toolchains: ["node"],
    });
    expect(plan[1]).toMatchObject({
      commands: ["cd services && echo manual"],
      repoPathFromWorkspaceRoot: "repos/backend",
      skipped: false,
      toolchains: [],
    });
  });

  test("renders devcontainer artifacts from the selected toolchains", () => {
    const workspace = createResolvedWorkspaceFixture({
      execution: {
        devcontainer: {
          enabled: true,
          remoteUser: "dev",
          workspaceFolder: "/workspaces/maestro",
        },
        worktrees: { enabled: false },
      },
      workspaceName: "maestro",
    });

    const plan = [
      createBootstrapPlanEntry({
        commands: [],
        repoPathFromWorkspaceRoot: "repos/frontend",
        repository: createRepositoryFixture({ name: "frontend" }),
        skipped: false,
        toolchains: ["composer", "node", "python", "uv"],
      }),
    ];

    const dockerfile = renderDevcontainerDockerfile(plan, workspace);
    const config = renderDevcontainerConfig(workspace);

    expect(dockerfile).toContain("nodejs npm");
    expect(dockerfile).toContain("python3 python3-pip python3-venv");
    expect(dockerfile).toContain("composer php-cli php-curl php-mbstring php-xml");
    expect(dockerfile).toContain("https://astral.sh/uv/install.sh");
    expect(config).toMatchObject({
      name: "maestro-workspace",
      postCreateCommand: "bash .devcontainer/bootstrap.sh",
      remoteUser: "dev",
      workspaceFolder: "/workspaces/maestro",
    });
  });

  test("renders bootstrap scripts from the planned repository commands", () => {
    const script = renderBootstrapScript([
      createBootstrapPlanEntry({
        commands: ["cd services && echo manual"],
        repoPathFromWorkspaceRoot: "repos/backend",
        repository: createRepositoryFixture({ name: "backend" }),
        skipped: false,
        toolchains: [],
      }),
      createBootstrapPlanEntry({
        commands: [],
        repoPathFromWorkspaceRoot: "repos/frontend",
        repository: createRepositoryFixture({ name: "frontend" }),
        skipped: true,
        toolchains: [],
      }),
    ]);

    expect(script).toContain("Bootstrapping workspace dependencies");
    expect(script).toContain("==> backend");
    expect(script).toContain('(cd "$WORKSPACE_ROOT"/repos/backend && cd services && echo manual)');
    expect(script).toContain("Skipping frontend: no bootstrap commands.");
  });

  test("syncs only the declared workspace overlay paths", async () => {
    const workspaceRoot = await createManagedTempDir("maestro-overlay-source-");
    const taskRoot = await createManagedTempDir("maestro-overlay-target-");

    await mkdir(path.join(workspaceRoot, ".maestro", "execution"), { recursive: true });
    await mkdir(path.join(workspaceRoot, "overrides"), { recursive: true });
    await writeFile(path.join(workspaceRoot, "AGENTS.md"), "agents\n");
    await writeFile(path.join(workspaceRoot, "maestro.yaml"), "workspace: test\n");
    await writeFile(path.join(workspaceRoot, "overrides", "policy.yaml"), "policy: true\n");
    await writeFile(
      path.join(workspaceRoot, ".maestro", "execution", "bootstrap-plan.json"),
      "[]\n",
    );
    await writeFile(path.join(workspaceRoot, ".maestro", "lock.json"), "{}\n");
    await writeFile(path.join(workspaceRoot, ".maestro", "state.json"), "{}\n");
    await writeFile(path.join(workspaceRoot, "unrelated.txt"), "ignore me\n");

    await syncWorkspaceOverlay(workspaceRoot, taskRoot);

    expect(await readFile(path.join(taskRoot, "AGENTS.md"), "utf8")).toBe("agents\n");
    expect(await readFile(path.join(taskRoot, "maestro.yaml"), "utf8")).toBe("workspace: test\n");
    expect(await readFile(path.join(taskRoot, "overrides", "policy.yaml"), "utf8")).toBe(
      "policy: true\n",
    );
    expect(
      await readFile(path.join(taskRoot, ".maestro", "execution", "bootstrap-plan.json"), "utf8"),
    ).toBe("[]\n");
    expect(await readFile(path.join(taskRoot, ".maestro", "lock.json"), "utf8")).toBe("{}\n");
    expect(await readFile(path.join(taskRoot, ".maestro", "state.json"), "utf8")).toBe("{}\n");
    expect(existsSync(path.join(taskRoot, "unrelated.txt"))).toBe(false);
  });
});
