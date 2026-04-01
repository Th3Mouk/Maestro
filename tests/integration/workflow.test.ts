import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  bootstrapWorkspace,
  checkoutWorkspaceGitBranches,
  createTaskWorktree,
  doctorWorkspace,
  initWorkspace,
  installWorkspace,
  pullWorkspaceGitBranches,
  syncWorkspaceGitBranches,
} from "../../src/core/commands.js";
import { createCommandContext } from "../../src/core/command-context.js";
import { projectEditorWorkspace } from "../../src/core/execution-service.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

afterEach(async () => {
  vi.unstubAllEnvs();
});

describe("end-to-end workspace lifecycle", () => {
  test("init creates AGENTS.md with task-oriented CLI guidance", async () => {
    const root = await createManagedTempDir("maestro-init-agents-md-");
    const workspaceRoot = path.join(root, "workspace");

    await initWorkspace(workspaceRoot);

    const agentsGuide = await readFile(path.join(workspaceRoot, "AGENTS.md"), "utf8");
    expect(agentsGuide).toContain("maestro git checkout --workspace .");
    expect(agentsGuide).toContain("maestro git pull --workspace .");
    expect(agentsGuide).toContain("maestro worktree --workspace . --task <task-name>");
  });

  test("init creates README.md with Maestro installation guidance", async () => {
    const root = await createManagedTempDir("maestro-init-readme-maestro-");
    const workspaceRoot = path.join(root, "workspace");

    await initWorkspace(workspaceRoot);

    const readme = await readFile(path.join(workspaceRoot, "README.md"), "utf8");
    expect(readme).toContain("## Maestro");
    expect(readme).toContain("This project uses Maestro to manage the workspace.");
    expect(readme).toContain(
      "[CLI install guide](https://github.com/Th3Mouk/maestro/blob/main/docs/cli/install.md)",
    );
    expect(readme).toContain("maestro install --workspace .");
  });

  test("init appends the Maestro guidance to an existing README.md", async () => {
    const root = await createManagedTempDir("maestro-init-readme-append-");
    const workspaceRoot = root;

    await writeFile(
      path.join(workspaceRoot, "README.md"),
      ["# Existing workspace", "", "Original project notes.", ""].join("\n"),
      "utf8",
    );

    await initWorkspace(workspaceRoot);

    const readme = await readFile(path.join(workspaceRoot, "README.md"), "utf8");
    expect(readme).toContain("# Existing workspace");
    expect(readme).toContain("Original project notes.");
    expect(readme).toContain("## Maestro");
    expect(readme).toContain(
      "[CLI install guide](https://github.com/Th3Mouk/maestro/blob/main/docs/cli/install.md)",
    );
    expect(readme.match(/## Maestro/g) ?? []).toHaveLength(1);
  });

  test("init does not scaffold a repo-local plugin marketplace", async () => {
    const root = await createManagedTempDir("maestro-init-plugin-marketplace-");
    const workspaceRoot = path.join(root, "workspace");

    await initWorkspace(workspaceRoot);

    expect(existsSync(path.join(workspaceRoot, ".agents", "plugins", "marketplace.json"))).toBe(
      false,
    );
  });

  test("init does not create the optional editor workspace file", async () => {
    const root = await createManagedTempDir("maestro-init-editor-workspace-");
    const workspaceRoot = path.join(root, "workspace");

    await initWorkspace(workspaceRoot);

    expect(existsSync(path.join(workspaceRoot, "maestro.code-workspace"))).toBe(false);
  });

  test("init does not scaffold a fragment directory", async () => {
    const root = await createManagedTempDir("maestro-init-fragments-");
    const workspaceRoot = path.join(root, "workspace");

    await initWorkspace(workspaceRoot);

    expect(existsSync(path.join(workspaceRoot, "fragments"))).toBe(false);
    expect(existsSync(path.join(workspaceRoot, "workspace"))).toBe(false);
  });

  test("code-workspace command generates the optional editor workspace file", async () => {
    const root = await createManagedTempDir("maestro-code-workspace-");
    const workspaceRoot = path.join(root, "workspace");

    await initWorkspace(workspaceRoot);
    await projectEditorWorkspace(workspaceRoot);

    const editorWorkspace = JSON.parse(
      await readFile(path.join(workspaceRoot, "maestro.code-workspace"), "utf8"),
    ) as {
      folders: Array<{ name: string; path: string }>;
    };

    expect(editorWorkspace.folders).toEqual([{ name: "workspace", path: "." }]);
  });

  test("init creates a neutral workspace descriptor", async () => {
    const root = await createManagedTempDir("maestro-init-workspace-descriptor-");
    const workspaceRoot = path.join(root, "workspace");

    await initWorkspace(workspaceRoot);

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

    expect(existsSync(path.join(workspaceRoot, ".maestro"))).toBe(true);
    expect(descriptor.schemaVersion).toBe("maestro.workspace/v1");
    expect(descriptor.workspace).toEqual({
      name: "workspace",
      root: ".",
      manifest: "maestro.yaml",
      agentsFile: "AGENTS.md",
    });
    expect(descriptor.layout).toEqual({
      repositoriesRoot: "repos",
      worktreesRoot: ".maestro/worktrees",
    });
    expect(descriptor.repositories).toEqual([]);
    expect(descriptor.projections).toEqual({
      runtimes: ["codex", "claude-code"],
      devcontainer: null,
    });
  });

  test("dry-run install does not materialize generated trees", async () => {
    const root = await createManagedTempDir("maestro-init-tree-");

    await writeFile(
      path.join(root, "maestro.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: init-tree",
        "spec:",
        "  runtimes:",
        "    codex:",
        "      enabled: true",
        "    claude-code:",
        "      enabled: true",
        "  repositories: []",
      ].join("\n"),
      "utf8",
    );

    const report = await installWorkspace(root, { dryRun: true });

    expect(report.status).toBe("ok");
    expect(existsSync(path.join(root, "repos"))).toBe(false);
    expect(existsSync(path.join(root, ".maestro"))).toBe(false);
    expect(existsSync(path.join(root, ".codex"))).toBe(false);
    expect(existsSync(path.join(root, ".claude"))).toBe(false);
    expect(existsSync(path.join(root, ".opencode"))).toBe(false);
    expect(existsSync(path.join(root, ".git"))).toBe(false);
  });

  test("install initializes the workspace root git repository when missing", async () => {
    const root = await createManagedTempDir("maestro-init-git-root-");

    await initWorkspace(root);

    await installWorkspace(root);

    expect(existsSync(path.join(root, ".git"))).toBe(true);
    expect((await execa("git", ["log", "--format=%s", "-1"], { cwd: root })).stdout.trim()).toBe(
      "🪄 booted by Maestro",
    );
  });

  test("install bootstraps the default .gitignore when the workspace was not initialized first", async () => {
    const root = await createManagedTempDir("maestro-install-gitignore-");

    await writeFile(
      path.join(root, "maestro.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: boot-tree",
        "spec:",
        "  runtimes:",
        "    codex:",
        "      enabled: true",
        "    claude-code:",
        "      enabled: true",
        "  repositories: []",
      ].join("\n"),
      "utf8",
    );

    await installWorkspace(root);

    const gitignore = await readFile(path.join(root, ".gitignore"), "utf8");
    expect(gitignore).toBe(
      [
        "repos/",
        ".maestro/",
        ".codex/",
        ".claude/",
        ".opencode/",
        ".mcp.json",
        "node_modules/",
        ".devcontainer/",
        "",
      ].join("\n"),
    );

    const trackedFiles = (
      await execa("git", ["ls-tree", "--name-only", "-r", "HEAD"], { cwd: root })
    ).stdout
      .split("\n")
      .filter(Boolean);

    expect(trackedFiles).toContain(".gitignore");
    expect((await execa("git", ["log", "--format=%s", "-1"], { cwd: root })).stdout.trim()).toBe(
      "🪄 booted by Maestro",
    );
  });

  test("install keeps an existing .gitignore and appends the missing default entries", async () => {
    const root = await createManagedTempDir("maestro-install-merge-gitignore-");

    await writeFile(
      path.join(root, "maestro.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: merge-tree",
        "spec:",
        "  runtimes:",
        "    codex:",
        "      enabled: true",
        "    claude-code:",
        "      enabled: true",
        "  repositories: []",
      ].join("\n"),
      "utf8",
    );
    await writeFile(path.join(root, ".gitignore"), ["node_modules/", "# keep this", ""].join("\n"));

    await installWorkspace(root);

    const gitignore = await readFile(path.join(root, ".gitignore"), "utf8");
    expect(gitignore).toBe(
      [
        "node_modules/",
        "# keep this",
        "repos/",
        ".maestro/",
        ".codex/",
        ".claude/",
        ".opencode/",
        ".mcp.json",
        ".devcontainer/",
        "",
      ].join("\n"),
    );

    const trackedFiles = (
      await execa("git", ["ls-tree", "--name-only", "-r", "HEAD"], { cwd: root })
    ).stdout
      .split("\n")
      .filter(Boolean);

    expect(trackedFiles).toContain(".gitignore");
  });

  test("installs a workspace with fragments, hooks, templates, runtimes and sparse repos", async () => {
    const { workspaceRoot } = await createScenario();
    const report = await installWorkspace(workspaceRoot);

    expect(report.status).toBe("ok");
    expect(report.repositories.map((entry) => entry.name)).toEqual([
      "sur-api",
      "admin",
      "sample-ci",
    ]);
    expect(existsSync(path.join(workspaceRoot, ".maestro", "lock.json"))).toBe(true);
    expect(
      existsSync(path.join(workspaceRoot, ".maestro", "execution", "bootstrap-plan.json")),
    ).toBe(true);
    expect(
      existsSync(path.join(workspaceRoot, ".maestro", "reports", "pack-core-install.json")),
    ).toBe(true);
    expect(existsSync(path.join(workspaceRoot, ".devcontainer", "devcontainer.json"))).toBe(true);
    expect(existsSync(path.join(workspaceRoot, ".devcontainer", "bootstrap.sh"))).toBe(true);
    expect(existsSync(path.join(workspaceRoot, "agents", "codex"))).toBe(true);
    expect(existsSync(path.join(workspaceRoot, "agents", "claude-code"))).toBe(false);
    expect(existsSync(path.join(workspaceRoot, "agents", "opencode"))).toBe(false);
    expect(existsSync(path.join(workspaceRoot, "skills"))).toBe(true);
    expect(existsSync(path.join(workspaceRoot, "skills", "local-runbook", "SKILL.md"))).toBe(true);
    expect(
      existsSync(path.join(workspaceRoot, ".maestro", "skills", "gha-normalizer", "SKILL.md")),
    ).toBe(true);
    expect(existsSync(path.join(workspaceRoot, ".agents", "plugins", "marketplace.json"))).toBe(
      true,
    );
    expect(
      existsSync(
        path.join(workspaceRoot, "plugins", "release-helper", ".codex-plugin", "plugin.json"),
      ),
    ).toBe(true);
    expect(existsSync(path.join(workspaceRoot, ".opencode", "skills"))).toBe(false);
    expect(
      JSON.parse(await readFile(path.join(workspaceRoot, ".opencode", "opencode.json"), "utf8")),
    ).toMatchObject({
      generated: true,
      workspace: "ops-workspace",
      skills: {
        paths: [".maestro/skills"],
      },
    });
    expect(existsSync(path.join(workspaceRoot, ".mcp.json"))).toBe(true);
    expect(await readFile(path.join(workspaceRoot, ".mcp.json"), "utf8")).toContain(
      '"shared-docs"',
    );
    expect(await readFile(path.join(workspaceRoot, ".codex", "config.toml"), "utf8")).toContain(
      "[mcp_servers.shared-docs]",
    );
    expect(await readFile(path.join(workspaceRoot, ".codex", "config.toml"), "utf8")).toContain(
      '[plugins."release-helper@ops-workspace"]',
    );
    expect(
      JSON.parse(await readFile(path.join(workspaceRoot, ".claude", "settings.json"), "utf8")),
    ).toMatchObject({
      enabledPlugins: {
        "release-helper@ops-workspace": true,
      },
      extraKnownMarketplaces: {
        "ops-workspace": {
          source: {
            source: "directory",
            path: "./plugins",
          },
        },
      },
    });
    expect(await readFile(path.join(workspaceRoot, "AGENTS.md"), "utf8")).toContain(
      "Generated by Maestro",
    );
    expect(
      JSON.parse(await readFile(path.join(workspaceRoot, "maestro.json"), "utf8")),
    ).toMatchObject({
      schemaVersion: "maestro.workspace/v1",
      workspace: {
        name: "ops-workspace",
        manifest: "maestro.yaml",
      },
      layout: {
        repositoriesRoot: "repos",
      },
      repositories: [
        { name: "sur-api", path: "repos/sur-api" },
        { name: "admin", path: "repos/admin" },
        { name: "sample-ci", path: "repos/sample-ci" },
      ],
    });
    expect(
      existsSync(
        path.join(workspaceRoot, "repos", "sur-api", ".github", "workflows", "deploy.yml"),
      ),
    ).toBe(true);
    expect(existsSync(path.join(workspaceRoot, "repos", "sur-api", "src", "Secret.php"))).toBe(
      false,
    );
    expect(await currentBranch(path.join(workspaceRoot, "repos", "sample-ci"))).toBe("main");
  });

  test("builds bootstrap commands from repository stacks in dry run mode", async () => {
    const { workspaceRoot } = await createScenario();
    await installWorkspace(workspaceRoot);

    const report = await bootstrapWorkspace(workspaceRoot, { dryRun: true });
    const surApi = report.repositories.find((entry) => entry.name === "sur-api");
    const admin = report.repositories.find((entry) => entry.name === "admin");

    expect(report.status).toBe("ok");
    expect(surApi?.commands.some((command) => command.includes("composer install"))).toBe(true);
    expect(admin?.commands.some((command) => command.includes("npm install"))).toBe(true);
  });

  test("doctor reports missing runtime artifacts", async () => {
    const { workspaceRoot } = await createScenario();
    await installWorkspace(workspaceRoot);
    await rm(path.join(workspaceRoot, ".codex", "config.toml"));
    await rm(path.join(workspaceRoot, ".mcp.json"));
    await rm(path.join(workspaceRoot, "maestro.json"));

    const report = await doctorWorkspace(workspaceRoot);
    expect(report.status).toBe("warning");
    expect(report.issues.some((issue) => issue.code === "RUNTIME_ARTIFACT_MISSING")).toBe(true);
    expect(report.issues.some((issue) => issue.code === "WORKSPACE_DESCRIPTOR_MISSING")).toBe(true);
  });

  test("doctor reports invalid workspace lock and state files", async () => {
    const { workspaceRoot } = await createScenario();
    await installWorkspace(workspaceRoot);

    await writeFile(path.join(workspaceRoot, ".maestro", "lock.json"), "{", "utf8");
    await writeFile(path.join(workspaceRoot, ".maestro", "state.json"), "{", "utf8");

    const report = await doctorWorkspace(workspaceRoot);
    expect(report.status).toBe("warning");
    expect(report.issues.some((issue) => issue.code === "LOCKFILE_INVALID")).toBe(true);
    expect(report.issues.some((issue) => issue.code === "STATE_INVALID")).toBe(true);
  });

  test("doctor reports invalid workspace descriptor files", async () => {
    const { workspaceRoot } = await createScenario();
    await installWorkspace(workspaceRoot);

    await writeFile(path.join(workspaceRoot, "maestro.json"), "{", "utf8");

    const report = await doctorWorkspace(workspaceRoot);
    expect(report.status).toBe("warning");
    expect(report.issues.some((issue) => issue.code === "WORKSPACE_DESCRIPTOR_INVALID")).toBe(true);
  });

  test("serializes concurrent writes to shared workspace reports", async () => {
    const { workspaceRoot } = await createScenario();
    await installWorkspace(workspaceRoot);

    await Promise.all([doctorWorkspace(workspaceRoot), doctorWorkspace(workspaceRoot)]);
    const doctorReport = await readFile(
      path.join(workspaceRoot, ".maestro", "reports", "doctor-report.json"),
      "utf8",
    );

    expect(() => JSON.parse(doctorReport)).not.toThrow();
  });

  test("creates isolated task worktrees for the workspace and managed repositories", async () => {
    const { workspaceRoot } = await createScenario();
    await installWorkspace(workspaceRoot);

    const report = await createTaskWorktree(workspaceRoot, "codex-a");
    const taskRoot = report.root;
    const taskRepoRoot = path.join(taskRoot, "repos", "sur-api");
    const canonicalRepoRoot = path.join(workspaceRoot, "repos", "sur-api");
    const workspaceFile = path.join(workspaceRoot, "maestro.yaml");
    const taskWorkspaceFile = path.join(taskRoot, "maestro.yaml");
    const taskWorkflowFile = path.join(taskRepoRoot, ".github", "workflows", "deploy.yml");
    const canonicalWorkflowFile = path.join(
      canonicalRepoRoot,
      ".github",
      "workflows",
      "deploy.yml",
    );

    expect(report.status).toBe("ok");
    expect(report.name).toBe("codex-a");
    expect(existsSync(taskRepoRoot)).toBe(true);
    expect(existsSync(path.join(taskRoot, ".maestro", "execution", "worktree.json"))).toBe(true);
    expect(
      JSON.parse(await readFile(path.join(taskRoot, "maestro.code-workspace"), "utf8")),
    ).toMatchObject({
      folders: [
        { name: "ops-workspace", path: "." },
        { name: "sur-api", path: "repos/sur-api" },
        { name: "admin", path: "repos/admin" },
        { name: "sample-ci", path: "repos/sample-ci" },
      ],
    });
    expect(JSON.parse(await readFile(path.join(taskRoot, "maestro.json"), "utf8"))).toMatchObject({
      schemaVersion: "maestro.workspace/v1",
      workspace: {
        name: "ops-workspace",
        manifest: "maestro.yaml",
      },
    });

    await writeFile(
      taskWorkspaceFile,
      `${await readFile(taskWorkspaceFile, "utf8")}\n# task\n`,
      "utf8",
    );
    await writeFile(
      taskWorkflowFile,
      `${await readFile(taskWorkflowFile, "utf8")}\n# isolated\n`,
      "utf8",
    );

    expect(await readFile(workspaceFile, "utf8")).not.toContain("# task");
    expect(await readFile(canonicalWorkflowFile, "utf8")).not.toContain("# isolated");
  });

  test("checks out managed repositories onto their reference branches", async () => {
    const { workspaceRoot } = await createScenario();
    await installWorkspace(workspaceRoot);

    const surApiRoot = path.join(workspaceRoot, "repos", "sur-api");
    await execa("git", ["checkout", "-b", "feature/local"], { cwd: surApiRoot });

    const report = await checkoutWorkspaceGitBranches(workspaceRoot);

    expect(report.status).toBe("ok");
    expect(report.command).toBe("checkout");
    expect(report.repositories.find((entry) => entry.name === "sur-api")?.status).toBe("updated");
    expect(report.repositories.find((entry) => entry.name === "admin")?.branch).toBe("develop");
    expect(await currentBranch(path.join(workspaceRoot, "repos", "sur-api"))).toBe("main");
    expect(await currentBranch(path.join(workspaceRoot, "repos", "admin"))).toBe("develop");
    expect(await currentBranch(path.join(workspaceRoot, "repos", "sample-ci"))).toBe("main");
  });

  test("reports checkout failures on dirty repositories without touching unrelated repos", async () => {
    const { workspaceRoot } = await createScenario();
    await installWorkspace(workspaceRoot);

    const surApiRoot = path.join(workspaceRoot, "repos", "sur-api");
    await execa("git", ["checkout", "-b", "feature/local"], { cwd: surApiRoot });
    await writeFile(path.join(surApiRoot, ".github", "workflows", "deploy.yml"), "dirty\n", "utf8");

    const report = await checkoutWorkspaceGitBranches(workspaceRoot);

    expect(report.status).toBe("warning");
    expect(report.issues.some((issue) => issue.code === "GIT_CHECKOUT_FAILED")).toBe(true);
    expect(report.repositories.find((entry) => entry.name === "sur-api")?.status).toBe("failed");
    expect(report.repositories.find((entry) => entry.name === "sur-api")?.branch).toBe(
      "feature/local",
    );
    expect(await currentBranch(surApiRoot)).toBe("feature/local");
    expect(await currentBranch(path.join(workspaceRoot, "repos", "admin"))).toBe("develop");
  });

  test("pulls the current branch for each managed repository", async () => {
    const { root, workspaceRoot } = await createScenario();
    await installWorkspace(workspaceRoot);
    await addCommitToBareRemote(
      root,
      path.join(root, "remotes", "sur-api.git"),
      "main",
      ".github/workflows/deploy.yml",
      "name: deploy-updated\n",
      "Update sur-api",
    );
    await addCommitToBareRemote(
      root,
      path.join(root, "remotes", "admin.git"),
      "develop",
      "package.json",
      '{"name":"admin","version":"2.0.0"}\n',
      "Update admin",
    );

    const report = await pullWorkspaceGitBranches(workspaceRoot);

    expect(report.status).toBe("ok");
    expect(report.command).toBe("pull");
    expect(report.repositories.find((entry) => entry.name === "sur-api")?.status).toBe("updated");
    expect(report.repositories.find((entry) => entry.name === "admin")?.status).toBe("updated");
    expect(
      await readFile(
        path.join(workspaceRoot, "repos", "sur-api", ".github", "workflows", "deploy.yml"),
        "utf8",
      ),
    ).toContain("deploy-updated");
    expect(
      await readFile(path.join(workspaceRoot, "repos", "admin", "package.json"), "utf8"),
    ).toContain('"version":"2.0.0"');
  });

  test("sync realigns then pulls managed repositories", async () => {
    const { root, workspaceRoot } = await createScenario();
    await installWorkspace(workspaceRoot);

    const surApiRoot = path.join(workspaceRoot, "repos", "sur-api");
    await execa("git", ["checkout", "-b", "feature/local"], { cwd: surApiRoot });
    await addCommitToBareRemote(
      root,
      path.join(root, "remotes", "sur-api.git"),
      "main",
      ".github/workflows/deploy.yml",
      "name: deploy-synced\n",
      "Update sur-api",
    );
    await addCommitToBareRemote(
      root,
      path.join(root, "remotes", "admin.git"),
      "develop",
      "package.json",
      '{"name":"admin","version":"3.0.0"}\n',
      "Update admin",
    );

    const report = await syncWorkspaceGitBranches(workspaceRoot);

    expect(report.status).toBe("ok");
    expect(report.command).toBe("sync");
    expect(await currentBranch(surApiRoot)).toBe("main");
    expect(
      await readFile(path.join(surApiRoot, ".github", "workflows", "deploy.yml"), "utf8"),
    ).toContain("deploy-synced");
    expect(
      await readFile(path.join(workspaceRoot, "repos", "admin", "package.json"), "utf8"),
    ).toContain('"version":"3.0.0"');
  });

  test("sync reports checkout failure and skips the pull for that repository", async () => {
    const { root, workspaceRoot } = await createScenario();
    await installWorkspace(workspaceRoot);

    const surApiRoot = path.join(workspaceRoot, "repos", "sur-api");
    await execa("git", ["checkout", "-b", "feature/local"], { cwd: surApiRoot });
    await writeFile(path.join(surApiRoot, ".github", "workflows", "deploy.yml"), "dirty\n", "utf8");
    await addCommitToBareRemote(
      root,
      path.join(root, "remotes", "sur-api.git"),
      "main",
      ".github/workflows/deploy.yml",
      "name: deploy-synced\n",
      "Update sur-api",
    );

    const report = await syncWorkspaceGitBranches(workspaceRoot);

    expect(report.status).toBe("warning");
    expect(report.command).toBe("sync");
    expect(report.repositories.find((entry) => entry.name === "sur-api")?.status).toBe("failed");
    expect(await currentBranch(surApiRoot)).toBe("feature/local");
    expect(
      await readFile(path.join(surApiRoot, ".github", "workflows", "deploy.yml"), "utf8"),
    ).toBe("dirty\n");
  });

  test("cli git commands return non-zero on partial failures", async () => {
    const { workspaceRoot } = await createScenario();
    await installWorkspace(workspaceRoot);

    const surApiRoot = path.join(workspaceRoot, "repos", "sur-api");
    await execa("git", ["checkout", "-b", "feature/local"], { cwd: surApiRoot });
    await writeFile(path.join(surApiRoot, ".github", "workflows", "deploy.yml"), "dirty\n", "utf8");

    const checkoutRun = await runCliCommand(["git", "checkout", "--workspace", workspaceRoot]);
    const checkoutReport = JSON.parse(checkoutRun.stdout);

    expect(checkoutRun.exitCode).toBe(1);
    expect(checkoutReport.status).toBe("warning");
    expect(checkoutReport.command).toBe("checkout");

    const pullRun = await runCliCommand(["git", "pull", "--workspace", workspaceRoot]);
    const pullReport = JSON.parse(pullRun.stdout);

    expect(pullRun.exitCode).toBe(1);
    expect(pullReport.status).toBe("warning");
    expect(pullReport.command).toBe("pull");
  });

  test("install and git loops emit deterministic progress on non-tty stderr", async () => {
    const { workspaceRoot } = await createScenario();
    const stderrCapture = createCapturedStderr(false);
    const context = createCommandContext({
      stderr: stderrCapture as unknown as NodeJS.WriteStream,
    });

    const installReport = await installWorkspace(workspaceRoot, {}, context);
    expect(installReport.status).toBe("ok");
    expect(stderrCapture.output).toContain("[maestro] install repositories: [1/3] start sur-api");
    expect(stderrCapture.output).toContain("[maestro] install repositories: completed 3/3");
    expect(stderrCapture.output).toContain(
      "[maestro] install repositories: projecting execution support",
    );

    stderrCapture.clear();
    const pullReport = await pullWorkspaceGitBranches(workspaceRoot, context);
    expect(pullReport.status).toBe("ok");
    expect(stderrCapture.output).toContain("[maestro] git pull: [1/3] start sur-api");
    expect(stderrCapture.output).toContain("[maestro] git pull: done (3/3)");
  });

  test("init includes git sync in the generated agent guide", async () => {
    const root = await createManagedTempDir("maestro-init-git-sync-");
    const workspaceRoot = path.join(root, "workspace");

    await initWorkspace(workspaceRoot);

    const agentsGuide = await readFile(path.join(workspaceRoot, "AGENTS.md"), "utf8");
    expect(agentsGuide).toContain("maestro git sync --workspace .");
  });
});

async function createScenario(): Promise<{ root: string; workspaceRoot: string }> {
  const root = await createManagedTempDir("maestro-e2e-");
  const workspaceRoot = path.join(root, "workspace");
  const packsRoot = path.join(root, "packs");
  const remotesRoot = path.join(root, "remotes");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(packsRoot, { recursive: true });
  await mkdir(remotesRoot, { recursive: true });

  const surApiRemote = await createBareRemoteRepo(remotesRoot, "sur-api", {
    ".github/workflows/deploy.yml": [
      "name: deploy",
      "permissions: write-all",
      "jobs:",
      "  deploy:",
      "    runs-on: ubuntu-latest",
    ].join("\n"),
    "deploy/values.yaml": "image: sample",
    "docker/Dockerfile": "FROM alpine:3.20",
    "helm/chart.yaml": "apiVersion: v2",
    "k8s/deployment.yaml": "kind: Deployment",
    "composer.json": '{"name":"org/sur-api"}',
    "src/Secret.php": '<?php echo "secret";',
  });

  const adminRemote = await createBareRemoteRepo(
    remotesRoot,
    "admin",
    {
      ".github/workflows/lint.yml": [
        "name: lint",
        "permissions: write-all",
        "jobs:",
        "  lint:",
        "    runs-on: ubuntu-latest",
      ].join("\n"),
      "package.json": '{"name":"admin"}',
      "eslint.config.js": "export default [];",
      Dockerfile: "FROM node:22-alpine",
      "src/index.ts": "export const value = 1;",
    },
    "develop",
  );

  const sampleCiRemote = await createBareRemoteRepo(remotesRoot, "sample-ci", {
    ".github/workflows/reuse.yml": "name: reuse",
    "deploy/app.yaml": "kind: Deployment",
  });

  await createPackCore(path.join(packsRoot, "pack-core"));
  await createPackGithubActions(path.join(packsRoot, "pack-github-actions"), sampleCiRemote);
  await createPackPrivate(path.join(packsRoot, "pack-private"));
  await createWorkspace(workspaceRoot, {
    surApiRemote,
    adminRemote,
    packCore: path.join(packsRoot, "pack-core"),
    packGithubActions: path.join(packsRoot, "pack-github-actions"),
    packPrivate: path.join(packsRoot, "pack-private"),
  });
  await initializeWorkspaceGitRepo(workspaceRoot);

  return { root, workspaceRoot };
}

async function createWorkspace(
  workspaceRoot: string,
  input: {
    surApiRemote: string;
    adminRemote: string;
    packCore: string;
    packGithubActions: string;
    packPrivate: string;
  },
): Promise<void> {
  await mkdir(path.join(workspaceRoot, "fragments"), { recursive: true });
  await mkdir(path.join(workspaceRoot, ".agents", "plugins"), { recursive: true });
  await mkdir(path.join(workspaceRoot, "agents", "codex"), { recursive: true });
  await mkdir(path.join(workspaceRoot, "plugins", "release-helper", ".codex-plugin"), {
    recursive: true,
  });
  await mkdir(path.join(workspaceRoot, "skills", "local-runbook"), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, "agents", "codex", "planner.toml"),
    [
      'name = "planner"',
      'description = "Workspace-specific planner."',
      'model = "gpt-5.4"',
      'model_reasoning_effort = "high"',
      'sandbox_mode = "read-only"',
      'developer_instructions = """',
      "Plan the workspace change before implementation.",
      '"""',
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(workspaceRoot, "skills", "local-runbook", "SKILL.md"),
    ["---", "name: local-runbook", "description: Local runbook skill.", "---"].join("\n"),
  );

  await writeFile(
    path.join(workspaceRoot, "maestro.yaml"),
    [
      "apiVersion: maestro/v1",
      "kind: Workspace",
      "metadata:",
      "  name: ops-workspace",
      "spec:",
      "  includes:",
      "    - fragments/packs.yaml",
      "    - fragments/mcp.yaml",
      "    - fragments/plugins.yaml",
      "    - fragments/repositories.yaml",
      "    - fragments/execution.yaml",
      "    - fragments/runtimes.yaml",
      "    - fragments/policies.yaml",
      "  agents:",
      "    codex:",
      "      - planner",
      "    claude-code:",
      "      - planner",
      "    opencode:",
      "      - planner",
      "  skills:",
      "    - gha-normalizer",
      "    - registry-auth-audit",
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(workspaceRoot, "AGENTS.md"),
    [
      "# AGENTS.md",
      "",
      "Generated by Maestro.",
      "",
      "Use this workspace CLI map to coordinate task-scoped worktrees.",
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(workspaceRoot, ".agents", "plugins", "marketplace.json"),
    JSON.stringify(
      {
        name: "ops-workspace",
        interface: {
          displayName: "Ops Workspace plugins",
        },
        plugins: [
          {
            name: "release-helper",
            source: {
              source: "local",
              path: "./plugins/release-helper",
            },
            policy: {
              installation: "AVAILABLE",
              authentication: "ON_INSTALL",
            },
            category: "Coding",
          },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );

  await writeFile(
    path.join(workspaceRoot, "plugins", "release-helper", ".codex-plugin", "plugin.json"),
    JSON.stringify(
      {
        name: "release-helper",
        version: "0.1.0",
        description: "Helps with release preparation.",
      },
      null,
      2,
    ),
    "utf8",
  );

  await writeFile(
    path.join(workspaceRoot, "fragments", "packs.yaml"),
    [
      "apiVersion: maestro/v1",
      "kind: WorkspaceFragment",
      "metadata:",
      "  name: packs",
      "spec:",
      "  packs:",
      '    - name: "@maestro/pack-core"',
      "      version: ^1.0.0",
      "      visibility: public",
      `      source: ${input.packCore}`,
      '    - name: "@maestro/pack-github-actions"',
      "      version: ^1.0.0",
      "      visibility: public",
      `      source: ${input.packGithubActions}`,
      '    - name: "@org/pack-private"',
      "      version: ^1.0.0",
      "      visibility: private",
      `      source: ${input.packPrivate}`,
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(workspaceRoot, "fragments", "mcp.yaml"),
    [
      "apiVersion: maestro/v1",
      "kind: WorkspaceFragment",
      "metadata:",
      "  name: mcp",
      "spec:",
      "  mcpServers:",
      "    - name: shared-docs",
      "      transport: stdio",
      "      command: npx",
      "      args:",
      "        - -y",
      '        - "@upstash/context7-mcp"',
      "    - name: sentry",
      "      transport: http",
      "      url: https://mcp.sentry.dev/mcp",
      "      bearerTokenEnvVar: SENTRY_AUTH_TOKEN",
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(workspaceRoot, "fragments", "plugins.yaml"),
    [
      "apiVersion: maestro/v1",
      "kind: WorkspaceFragment",
      "metadata:",
      "  name: plugins",
      "spec:",
      "  plugins:",
      "    codex:",
      "      enabled:",
      '        "release-helper@ops-workspace": true',
      '        "github@openai-curated": false',
      "    claude-code:",
      "      enabled:",
      '        "release-helper@ops-workspace": true',
      "      marketplaces:",
      "        ops-workspace:",
      "          source:",
      "            source: directory",
      "            path: ./plugins",
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(workspaceRoot, "fragments", "repositories.yaml"),
    [
      "apiVersion: maestro/v1",
      "kind: WorkspaceFragment",
      "metadata:",
      "  name: repos",
      "spec:",
      "  repositories:",
      "    - name: sur-api",
      `      remote: ${input.surApiRemote}`,
      "      branch: main",
      "      sparse:",
      "        mode: cone",
      "        visiblePaths:",
      "          - .github/",
      "          - deploy/",
      "          - docker/",
      "          - helm/",
      "          - k8s/",
      "          - composer.json",
      "      bootstrap:",
      "        strategy: auto",
      "      permissions:",
      "        writablePaths:",
      "          - .github/**",
      "          - deploy/**",
      "          - docker/**",
      "          - helm/**",
      "          - k8s/**",
      "          - composer.json",
      "        forbiddenPaths:",
      "          - src/**",
      "          - tests/**",
      "    - name: admin",
      `      remote: ${input.adminRemote}`,
      "      branch: develop",
      "      sparse:",
      "        mode: pattern",
      "        visiblePaths:",
      "          - .github/",
      "          - package.json",
      "          - eslint.config.js",
      "          - Dockerfile",
      "      bootstrap:",
      "        strategy: auto",
      "      permissions:",
      "        writablePaths:",
      "          - .github/**",
      "          - package.json",
      "          - eslint.config.js",
      "          - Dockerfile",
      "        forbiddenPaths:",
      "          - src/**",
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(workspaceRoot, "fragments", "execution.yaml"),
    [
      "apiVersion: maestro/v1",
      "kind: WorkspaceFragment",
      "metadata:",
      "  name: execution",
      "spec:",
      "  execution:",
      "    devcontainer:",
      "      enabled: true",
      "      workspaceFolder: /workspace/ops-workspace",
      "    worktrees:",
      "      enabled: true",
      "      rootDir: .maestro/worktrees",
      "      branchPrefix: task",
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(workspaceRoot, "fragments", "runtimes.yaml"),
    [
      "apiVersion: maestro/v1",
      "kind: WorkspaceFragment",
      "metadata:",
      "  name: runtimes",
      "spec:",
      "  runtimes:",
      "    codex:",
      "      enabled: true",
      "    claude-code:",
      "      enabled: true",
      "    opencode:",
      "      enabled: true",
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(workspaceRoot, "fragments", "policies.yaml"),
    [
      "apiVersion: maestro/v1",
      "kind: WorkspaceFragment",
      "metadata:",
      "  name: policies",
      "spec:",
      "  policies:",
      "    - name: allowed-paths",
      "      spec:",
      "        writable:",
      "          - .github/**",
      "          - deploy/**",
      "          - docker/**",
      "          - helm/**",
      "          - k8s/**",
      "          - composer.json",
      "          - package.json",
      "          - eslint.config.js",
      "          - Dockerfile",
      "    - name: no-source-changes-in-ops",
      "      spec:",
      "        forbidden:",
      "          - src/**",
      "          - tests/**",
      "    - name: diff-size-limit",
      "      spec:",
      "        maxChangedFiles: 20",
      "        maxAddedLines: 100",
      "        maxDeletedLines: 100",
      "    - name: branch-naming",
      "      spec:",
      '        pattern: "^chore/(ops|backend|frontend)-[a-z0-9._-]+$"',
    ].join("\n"),
    "utf8",
  );
}

async function createPackCore(packRoot: string): Promise<void> {
  await mkdir(path.join(packRoot, "policies"), { recursive: true });
  await mkdir(path.join(packRoot, "skills", "gha-normalizer"), { recursive: true });
  await mkdir(path.join(packRoot, "templates"), { recursive: true });
  await mkdir(path.join(packRoot, "scripts"), { recursive: true });

  await writeFile(
    path.join(packRoot, "pack.yaml"),
    [
      "apiVersion: maestro/v1",
      "kind: Pack",
      "metadata:",
      '  name: "@maestro/pack-core"',
      "  version: 1.0.0",
      "  visibility: public",
      "spec:",
      "  compatibility:",
      '    framework: ">=0.1.0 <1.0.0"',
      "  provides:",
      "    agents:",
      "      codex:",
      "        - planner",
      "      claude-code:",
      "        - planner",
      "      opencode:",
      "        - planner",
      "    skills:",
      "      - gha-normalizer",
      "    policies:",
      "      - allowed-paths",
      "      - diff-size-limit",
      "    hooks:",
      "      install:",
      "        - scripts/install.js",
      "      validate:",
      "        - scripts/validate.js",
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(packRoot, "policies", "allowed-paths.yaml"),
    ["name: allowed-paths", "spec:", "  writable:", "    - .github/**", "    - package.json"].join(
      "\n",
    ),
    "utf8",
  );

  await writeFile(
    path.join(packRoot, "policies", "diff-size-limit.yaml"),
    [
      "name: diff-size-limit",
      "spec:",
      "  maxChangedFiles: 20",
      "  maxAddedLines: 100",
      "  maxDeletedLines: 100",
    ].join("\n"),
    "utf8",
  );

  await writeFile(
    path.join(packRoot, "skills", "gha-normalizer", "SKILL.md"),
    ["---", "name: gha-normalizer", "description: Normalize workflows.", "---"].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(packRoot, "templates", "AGENTS.md"),
    "# AGENTS\n\nGenerated by Maestro.\n",
    "utf8",
  );
  await writeFile(
    path.join(packRoot, "templates", "CLAUDE.md"),
    "# CLAUDE\n\nGenerated by Maestro.\n",
    "utf8",
  );
  await writeFile(
    path.join(packRoot, "scripts", "install.js"),
    [
      "import { writeFileSync } from 'node:fs';",
      "import path from 'node:path';",
      "export function install(context) {",
      "  writeFileSync(path.join(context.maestroRoot, '.maestro', 'reports', 'pack-core-install.json'), JSON.stringify({ ok: true }, null, 2));",
      "  return { ok: true, message: 'installed' };",
      "}",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(packRoot, "scripts", "validate.js"),
    "export function validate() { return { ok: true, message: 'validated' }; }\n",
    "utf8",
  );
}

async function createPackGithubActions(packRoot: string, sampleCiRemote: string): Promise<void> {
  await mkdir(path.join(packRoot, "fragments"), { recursive: true });
  await writeFile(
    path.join(packRoot, "pack.yaml"),
    [
      "apiVersion: maestro/v1",
      "kind: Pack",
      "metadata:",
      '  name: "@maestro/pack-github-actions"',
      "  version: 1.0.0",
      "  visibility: public",
      "spec:",
      "  compatibility:",
      '    framework: ">=0.1.0 <1.0.0"',
      "  fragments:",
      "    - repositories.partial.yaml",
      "    - runtimes.partial.yaml",
      "  provides:",
      "    policies:",
      "      - no-source-changes-in-ops",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(packRoot, "fragments", "repositories.partial.yaml"),
    [
      "repositories:",
      "  - name: sample-ci",
      `    remote: ${sampleCiRemote}`,
      "    sparse:",
      "      mode: cone",
      "      visiblePaths:",
      "        - .github/",
      "        - deploy/",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(packRoot, "fragments", "runtimes.partial.yaml"),
    [
      "runtimes:",
      "  codex:",
      "    installAgents: true",
      "  claude-code:",
      "    installProjectInstructions: true",
      "  opencode:",
      "    installProjectConfig: true",
    ].join("\n"),
    "utf8",
  );
}

async function createPackPrivate(packRoot: string): Promise<void> {
  await mkdir(path.join(packRoot, "skills", "registry-auth-audit"), { recursive: true });
  await writeFile(
    path.join(packRoot, "pack.yaml"),
    [
      "apiVersion: maestro/v1",
      "kind: Pack",
      "metadata:",
      '  name: "@org/pack-private"',
      "  version: 1.0.0",
      "  visibility: private",
      "spec:",
      "  compatibility:",
      '    framework: ">=0.1.0 <1.0.0"',
      "  provides:",
      "    skills:",
      "      - registry-auth-audit",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(packRoot, "skills", "registry-auth-audit", "SKILL.md"),
    ["---", "name: registry-auth-audit", "description: Audit registry auth.", "---"].join("\n"),
    "utf8",
  );
}

async function createBareRemoteRepo(
  root: string,
  name: string,
  files: Record<string, string>,
  initialBranch = "main",
): Promise<string> {
  const sourceRoot = path.join(root, `${name}-source`);
  const bareRoot = path.join(root, `${name}.git`);
  await mkdir(sourceRoot, { recursive: true });
  await execa("git", ["init", `--initial-branch=${initialBranch}`], { cwd: sourceRoot });
  await execa("git", ["config", "user.name", "Test User"], { cwd: sourceRoot });
  await execa("git", ["config", "user.email", "test@example.invalid"], { cwd: sourceRoot });

  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(sourceRoot, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content, "utf8");
  }

  await execa("git", ["add", "."], { cwd: sourceRoot });
  await execa("git", ["-c", "commit.gpgSign=false", "commit", "-m", "Initial commit"], {
    cwd: sourceRoot,
  });
  await execa("git", ["clone", "--bare", sourceRoot, bareRoot]);
  return bareRoot;
}

async function addCommitToBareRemote(
  root: string,
  remote: string,
  branchName: string,
  relativePath: string,
  content: string,
  commitMessage: string,
): Promise<void> {
  const cloneRoot = path.join(root, `${branchName}-push-${Date.now()}`);
  await execa("git", ["clone", remote, cloneRoot]);
  await execa("git", ["config", "user.name", "Test User"], { cwd: cloneRoot });
  await execa("git", ["config", "user.email", "test@example.invalid"], { cwd: cloneRoot });
  await execa("git", ["checkout", branchName], { cwd: cloneRoot });
  await writeFile(path.join(cloneRoot, relativePath), content, "utf8");
  await execa("git", ["-c", "commit.gpgSign=false", "commit", "-am", commitMessage], {
    cwd: cloneRoot,
  });
  await execa("git", ["push", "origin", branchName], { cwd: cloneRoot });
}

async function currentBranch(repoRoot: string): Promise<string> {
  return (
    await execa("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot })
  ).stdout.trim();
}

async function runCliCommand(
  args: string[],
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const cliPath = path.join(process.cwd(), "bin", "maestro.js");
  const result = await execa("node", [cliPath, ...args], {
    reject: false,
  });

  return {
    exitCode: result.exitCode ?? 0,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

interface CapturedStderr {
  clear: () => void;
  isTTY: boolean;
  output: string;
  write: (chunk: string | Uint8Array) => boolean;
}

function createCapturedStderr(isTTY: boolean): CapturedStderr {
  let output = "";
  const capture: CapturedStderr = {
    isTTY,
    get output() {
      return output;
    },
    clear: () => {
      output = "";
    },
    write: (chunk: string | Uint8Array) => {
      output += chunk.toString();
      return true;
    },
  };

  return capture;
}

async function initializeWorkspaceGitRepo(workspaceRoot: string): Promise<void> {
  await execa("git", ["init", "--initial-branch=main"], { cwd: workspaceRoot });
  await execa("git", ["config", "user.name", "Test User"], { cwd: workspaceRoot });
  await execa("git", ["config", "user.email", "test@example.invalid"], { cwd: workspaceRoot });
  await execa("git", ["add", "."], { cwd: workspaceRoot });
  await execa("git", ["-c", "commit.gpgSign=false", "commit", "-m", "Initial workspace"], {
    cwd: workspaceRoot,
  });
}
