import { cp, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { quote } from "shell-quote";
import type { BootstrapReport, ReportStatus, TaskWorktreeReport } from "../report/types.js";
import type { RuntimeName } from "../runtime/types.js";
import type { RepositoryRef, ResolvedWorkspace } from "../workspace/types.js";
import { errorMessage, MaestroError } from "./errors.js";
import { renderWorkspaceDescriptor, workspaceDescriptorFileName } from "./workspace-descriptor.js";
import { editorWorkspaceFileName, renderEditorWorkspace } from "./editor-workspace.js";
import {
  ensureDir,
  mapWithConcurrency,
  pathExists,
  removeIfExists,
  resolveSafePath,
  withWorkspaceLock,
  writeJson,
  writeText,
} from "../utils/fs.js";
import { getRepositoryReferenceBranch } from "../workspace/repositories.js";
import { getWorkspaceStateRoot, workspaceStateDirName } from "../workspace/state-directory.js";

export type ExecutionGitAdapter = {
  hasGitMetadata: (repoRoot: string) => Promise<boolean>;
  ensureWorktree: (
    repoRoot: string,
    worktreePath: string,
    branchName: string,
    baseRef?: string,
    dryRun?: boolean,
  ) => Promise<"created" | "updated" | "unchanged">;
};

interface ExecutionServiceContext {
  gitAdapter: ExecutionGitAdapter;
}

interface RepositoryBootstrapPlan {
  repository: RepositoryRef;
  repoRoot: string;
  repoPathFromWorkspaceRoot: string;
  commands: string[];
  toolchains: string[];
  skipped: boolean;
}

const REPOSITORY_CONCURRENCY_LIMIT = 4;
const OVERLAY_COPY_CONCURRENCY_LIMIT = 4;
const workspaceOverlayPaths = [
  "maestro.yaml",
  "workspace",
  "agents",
  "skills",
  "package.json",
  "README.md",
  ".gitignore",
  "overrides",
  ".codex",
  ".claude",
  ".opencode",
  ".devcontainer",
  "AGENTS.md",
  "CLAUDE.md",
  workspaceDescriptorFileName,
];

export async function projectExecutionSupport(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  dryRun = false,
): Promise<string[]> {
  const actions: string[] = [];
  const executionRoot = getWorkspaceStateRoot(workspaceRoot, "execution");
  const bootstrapPlan = await buildBootstrapPlan(workspaceRoot, resolvedWorkspace);

  if (!dryRun) {
    await withWorkspaceLock(workspaceRoot, async () => {
      await ensureDir(executionRoot);
      await writeText(
        path.join(workspaceRoot, workspaceDescriptorFileName),
        renderWorkspaceDescriptor({
          execution: resolvedWorkspace.execution,
          repositories: resolvedWorkspace.repositories,
          runtimeNames: Object.keys(resolvedWorkspace.runtimes) as RuntimeName[],
          workspaceName: resolvedWorkspace.manifest.metadata.name,
        }),
      );
      await writeJson(
        path.join(executionRoot, "bootstrap-plan.json"),
        bootstrapPlan.map((entry) => ({
          commands: entry.commands,
          name: entry.repository.name,
          skipped: entry.skipped,
          toolchains: entry.toolchains,
        })),
      );
      await writeText(
        path.join(executionRoot, "bootstrap.sh"),
        renderBootstrapScript(bootstrapPlan),
      );
    });
  }
  actions.push("execution:bootstrap");
  actions.push("execution:workspace-descriptor");

  if (resolvedWorkspace.execution.worktrees?.enabled) {
    const worktreeConfig = resolvedWorkspace.execution.worktrees;
    if (!dryRun) {
      const worktreeRoot = getTaskWorktreesRoot(workspaceRoot, resolvedWorkspace);
      await withWorkspaceLock(workspaceRoot, async () => {
        await ensureDir(worktreeRoot);
        await writeJson(path.join(executionRoot, "worktrees.json"), {
          branchPrefix: worktreeConfig?.branchPrefix ?? "task",
          rootDir: path.relative(workspaceRoot, worktreeRoot) || ".",
        });
      });
    }
    actions.push("execution:worktrees");
  }

  if (resolvedWorkspace.execution.devcontainer?.enabled) {
    if (!dryRun) {
      await ensureDir(path.join(workspaceRoot, ".devcontainer"));
      await writeText(
        path.join(workspaceRoot, ".devcontainer", "Dockerfile"),
        renderDevcontainerDockerfile(bootstrapPlan, resolvedWorkspace),
      );
      await writeText(
        path.join(workspaceRoot, ".devcontainer", "bootstrap.sh"),
        renderBootstrapScript(bootstrapPlan),
      );
      await writeJson(
        path.join(workspaceRoot, ".devcontainer", "devcontainer.json"),
        renderDevcontainerConfig(resolvedWorkspace),
      );
    }
    actions.push("execution:devcontainer");
  }

  return actions;
}

export async function projectEditorWorkspace(workspaceRoot: string, dryRun = false): Promise<void> {
  const { resolveWorkspace } = await import("./workspace-service.js");
  const resolvedWorkspace = await resolveWorkspace(workspaceRoot);

  if (dryRun) {
    return;
  }

  await withWorkspaceLock(workspaceRoot, async () => {
    await writeText(
      path.join(workspaceRoot, editorWorkspaceFileName),
      renderEditorWorkspace({
        repositories: resolvedWorkspace.repositories,
        workspaceName: resolvedWorkspace.manifest.metadata.name,
      }),
    );
  });
}

export async function bootstrapWorkspace(
  workspaceRoot: string,
  options: { repository?: string; dryRun?: boolean } = {},
): Promise<BootstrapReport> {
  const { resolveWorkspace } = await import("./workspace-service.js");
  const resolvedWorkspace = await resolveWorkspace(workspaceRoot);
  const bootstrapPlan = await buildBootstrapPlan(workspaceRoot, resolvedWorkspace);
  const selectedEntries = options.repository
    ? bootstrapPlan.filter((entry) => entry.repository.name === options.repository)
    : bootstrapPlan;
  const report: BootstrapReport = {
    status: "ok",
    workspace: resolvedWorkspace.manifest.metadata.name,
    repositories: [],
    issues: [],
  };

  if (options.repository && selectedEntries.length === 0) {
    report.status = "error";
    report.issues.push({
      code: "REPOSITORY_NOT_FOUND",
      message: `Repository not found: ${options.repository}`,
    });
    return report;
  }

  report.repositories = selectedEntries.map((entry) => ({
    commands: entry.commands,
    name: entry.repository.name,
    skipped: entry.skipped,
  }));

  const executionOutcomes = await mapWithConcurrency(
    selectedEntries,
    REPOSITORY_CONCURRENCY_LIMIT,
    async (entry) => {
      if (entry.skipped || options.dryRun) {
        return { issue: undefined };
      }

      for (const command of entry.commands) {
        try {
          await execa("bash", ["-lc", command], {
            cwd: entry.repoRoot,
            stdio: "inherit",
          });
        } catch (error) {
          return {
            issue: {
              code: "BOOTSTRAP_COMMAND_FAILED",
              message: buildBootstrapFailureMessage(entry.repository.name, command, error),
              path: entry.repoRoot,
            },
          };
        }
      }

      return { issue: undefined };
    },
  );

  for (const outcome of executionOutcomes) {
    if (outcome.issue) {
      report.status = escalateReportStatus(report.status, "warning");
      report.issues.push(outcome.issue);
    }
  }

  return report;
}

export async function prepareTaskWorktree(
  workspaceRoot: string,
  taskName: string,
  options: { dryRun?: boolean } = {},
  context: ExecutionServiceContext,
): Promise<TaskWorktreeReport> {
  const { gitAdapter } = context;
  const { resolveWorkspace } = await import("./workspace-service.js");
  const resolvedWorkspace = await resolveWorkspace(workspaceRoot);
  const sanitizedTaskName = sanitizeSegment(taskName);
  const worktrees = resolvedWorkspace.execution.worktrees;
  const taskRoot = resolveSafePath(
    getTaskWorktreesRoot(workspaceRoot, resolvedWorkspace),
    sanitizedTaskName,
    "task worktree root",
  );
  const report: TaskWorktreeReport = {
    status: "ok",
    workspace: resolvedWorkspace.manifest.metadata.name,
    name: taskName,
    root: taskRoot,
    repositories: [],
    issues: [],
  };

  if (!worktrees?.enabled) {
    report.status = "error";
    report.issues.push({
      code: "WORKTREES_DISABLED",
      message: "Task worktrees are disabled in spec.execution.worktrees.",
    });
    return report;
  }

  if (options.dryRun) {
    for (const repository of resolvedWorkspace.repositories) {
      report.repositories.push({
        branch: createTaskBranchName(worktrees.branchPrefix, taskName, repository.name),
        name: repository.name,
        path: resolveSafePath(
          taskRoot,
          path.join("repos", repository.name),
          "task repository path",
        ),
        status: "created",
      });
    }
    return report;
  }

  await ensureDir(path.dirname(taskRoot));
  if (await gitAdapter.hasGitMetadata(workspaceRoot)) {
    await gitAdapter.ensureWorktree(
      workspaceRoot,
      taskRoot,
      createTaskBranchName(
        worktrees.branchPrefix,
        taskName,
        resolvedWorkspace.manifest.metadata.name,
      ),
      "HEAD",
    );
  } else {
    await ensureDir(taskRoot);
    report.status = "warning";
    report.issues.push({
      code: "WORKSPACE_GIT_MISSING",
      message:
        "The workspace root is not a Git repository. Artifacts will be copied without a Git worktree for the root.",
      path: workspaceRoot,
    });
  }

  await syncWorkspaceOverlay(workspaceRoot, taskRoot);
  await ensureDir(resolveSafePath(taskRoot, "repos", "task repositories root"));

  const repositoryOutcomes = await mapWithConcurrency(
    resolvedWorkspace.repositories,
    REPOSITORY_CONCURRENCY_LIMIT,
    async (repository) => {
      const sourceRepoRoot = resolveSafePath(
        workspaceRoot,
        path.join("repos", repository.name),
        "workspace repository path",
      );
      const targetRepoRoot = resolveSafePath(
        taskRoot,
        path.join("repos", repository.name),
        "task repository path",
      );
      if (!(await gitAdapter.hasGitMetadata(sourceRepoRoot))) {
        return {
          issue: {
            code: "REPO_MISSING",
            message: `Repository not installed: ${repository.name}`,
            path: sourceRepoRoot,
          },
        };
      }

      const branch = createTaskBranchName(worktrees.branchPrefix, taskName, repository.name);
      const status = await gitAdapter.ensureWorktree(
        sourceRepoRoot,
        targetRepoRoot,
        branch,
        getRepositoryReferenceBranch(repository),
      );

      return {
        repository: {
          branch,
          name: repository.name,
          path: targetRepoRoot,
          status,
        },
      };
    },
  );

  for (const outcome of repositoryOutcomes) {
    if (outcome.issue) {
      report.status = "warning";
      report.issues.push(outcome.issue);
      continue;
    }

    if (outcome.repository) {
      report.repositories.push(outcome.repository);
    }
  }

  await withWorkspaceLock(taskRoot, async () => {
    await writeText(
      path.join(taskRoot, editorWorkspaceFileName),
      renderEditorWorkspace({
        repositories: resolvedWorkspace.repositories,
        workspaceName: resolvedWorkspace.manifest.metadata.name,
      }),
    );
    await writeText(
      path.join(taskRoot, workspaceDescriptorFileName),
      renderWorkspaceDescriptor({
        execution: resolvedWorkspace.execution,
        repositories: resolvedWorkspace.repositories,
        runtimeNames: Object.keys(resolvedWorkspace.runtimes) as RuntimeName[],
        workspaceName: resolvedWorkspace.manifest.metadata.name,
      }),
    );
    await writeJson(path.join(taskRoot, workspaceStateDirName, "execution", "worktree.json"), {
      name: taskName,
      createdAt: new Date().toISOString(),
      root: taskRoot,
    });
  });

  return report;
}

function getTaskWorktreesRoot(workspaceRoot: string, resolvedWorkspace: ResolvedWorkspace): string {
  return resolveSafePath(
    workspaceRoot,
    resolvedWorkspace.execution.worktrees?.rootDir ?? path.join(workspaceStateDirName, "worktrees"),
    "worktree rootDir",
  );
}

async function buildBootstrapPlan(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
): Promise<RepositoryBootstrapPlan[]> {
  return mapWithConcurrency(
    resolvedWorkspace.repositories,
    REPOSITORY_CONCURRENCY_LIMIT,
    async (repository) => {
      const repoRoot = resolveSafePath(
        workspaceRoot,
        path.join("repos", repository.name),
        "workspace repository path",
      );
      const commands = await detectBootstrapCommands(repository, repoRoot);
      return {
        commands,
        repoRoot,
        repoPathFromWorkspaceRoot: toPosixPath(path.relative(workspaceRoot, repoRoot)),
        repository,
        skipped: commands.length === 0 || repository.bootstrap?.enabled === false,
        toolchains: detectToolchains(commands),
      };
    },
  );
}

async function detectBootstrapCommands(
  repository: RepositoryRef,
  repoRoot: string,
): Promise<string[]> {
  const workingDirectory = repository.bootstrap?.workingDirectory ?? ".";

  if (repository.bootstrap?.enabled === false) {
    return [];
  }

  if (repository.bootstrap?.strategy === "manual") {
    return dedupe(repository.bootstrap.commands ?? []).map((command) =>
      prefixWorkingDirectory(command, workingDirectory),
    );
  }

  const commands = [...(repository.bootstrap?.commands ?? [])];
  const root = resolveSafePath(repoRoot, workingDirectory, "bootstrap workingDirectory");

  if (!(await pathExists(root))) {
    return commands;
  }

  const [hasComposer, hasPackageJson, hasPyproject, hasUvLock, hasRequirements] = await Promise.all(
    [
      pathExists(path.join(root, "composer.json")),
      pathExists(path.join(root, "package.json")),
      pathExists(path.join(root, "pyproject.toml")),
      pathExists(path.join(root, "uv.lock")),
      pathExists(path.join(root, "requirements.txt")),
    ],
  );

  if (hasComposer) {
    commands.push("composer install --no-interaction --prefer-dist");
  }

  if (hasUvLock) {
    commands.push("uv sync");
  } else if (hasPyproject && (await pyprojectMentionsUv(path.join(root, "pyproject.toml")))) {
    commands.push("uv sync");
  } else if (hasRequirements) {
    commands.push(
      "python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt",
    );
  }

  if (hasPackageJson) {
    commands.push(await detectNodeInstallCommand(root));
  }

  return dedupe(commands).map((command) => prefixWorkingDirectory(command, workingDirectory));
}

async function detectNodeInstallCommand(repoRoot: string): Promise<string> {
  const [hasPnpmLock, hasYarnLock, hasBunLockb, hasBunLock, hasPackageLock] = await Promise.all([
    pathExists(path.join(repoRoot, "pnpm-lock.yaml")),
    pathExists(path.join(repoRoot, "yarn.lock")),
    pathExists(path.join(repoRoot, "bun.lockb")),
    pathExists(path.join(repoRoot, "bun.lock")),
    pathExists(path.join(repoRoot, "package-lock.json")),
  ]);

  if (hasPnpmLock) {
    return "corepack enable >/dev/null 2>&1 || true; pnpm install --frozen-lockfile || pnpm install";
  }

  if (hasYarnLock) {
    return "corepack enable >/dev/null 2>&1 || true; yarn install --immutable || yarn install";
  }

  if (hasBunLockb || hasBunLock) {
    return "bun install";
  }

  if (hasPackageLock) {
    return "npm ci || npm install";
  }

  return "npm install";
}

async function pyprojectMentionsUv(pyprojectPath: string): Promise<boolean> {
  if (!(await pathExists(pyprojectPath))) {
    return false;
  }

  const content = await readFile(pyprojectPath, "utf8");
  return content.includes("[tool.uv]") || content.includes("[project]");
}

function detectToolchains(commands: string[]): string[] {
  const tools = new Set<string>();
  for (const command of commands) {
    if (command.includes("composer ")) {
      tools.add("php");
      tools.add("composer");
    }
    if (command.includes("uv ")) {
      tools.add("python");
      tools.add("uv");
    }
    if (command.includes("python3 ") || command.includes("pip install")) {
      tools.add("python");
    }
    if (
      command.includes("pnpm ") ||
      command.includes("yarn ") ||
      command.includes("npm ") ||
      command.includes("bun ")
    ) {
      tools.add("node");
    }
  }
  return [...tools].sort((left, right) => left.localeCompare(right));
}

function renderBootstrapScript(plan: RepositoryBootstrapPlan[]): string {
  const lines = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"',
    "printf '%s\\n' \"Bootstrapping workspace dependencies from $WORKSPACE_ROOT\"",
    "",
  ];

  for (const entry of plan) {
    lines.push(`printf '%s\\n' ${quote([`==> ${entry.repository.name}`])}`);
    if (entry.skipped) {
      lines.push(
        `printf '%s\\n' ${quote([`Skipping ${entry.repository.name}: no bootstrap commands.`])}`,
      );
      lines.push("");
      continue;
    }

    for (const command of entry.commands) {
      lines.push(
        `(cd "$WORKSPACE_ROOT"/${quote([entry.repoPathFromWorkspaceRoot])} && ${command})`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function renderDevcontainerDockerfile(
  plan: RepositoryBootstrapPlan[],
  resolvedWorkspace: ResolvedWorkspace,
): string {
  const toolchains = new Set(plan.flatMap((entry) => entry.toolchains));
  const packages = ["bash", "ca-certificates", "curl", "git", "unzip"];

  if (toolchains.has("node")) {
    packages.push("nodejs", "npm");
  }

  if (toolchains.has("python")) {
    packages.push("python3", "python3-pip", "python3-venv");
  }

  if (toolchains.has("php") || toolchains.has("composer")) {
    packages.push("composer", "php-cli", "php-curl", "php-mbstring", "php-xml");
  }

  const lines = [
    `FROM ${resolvedWorkspace.execution.devcontainer?.baseImage ?? "mcr.microsoft.com/devcontainers/base:ubuntu"}`,
    "",
    "ARG DEBIAN_FRONTEND=noninteractive",
    "",
    "RUN apt-get update \\",
    `  && apt-get install -y ${packages.join(" ")} \\`,
    "  && rm -rf /var/lib/apt/lists/*",
  ];

  if (toolchains.has("node")) {
    lines.push("", "RUN npm install -g corepack && corepack enable || true");
  }

  if (toolchains.has("uv")) {
    lines.push(
      "",
      "RUN curl -LsSf https://astral.sh/uv/install.sh | sh",
      'ENV PATH="/root/.local/bin:${PATH}"',
    );
  }

  return `${lines.join("\n")}\n`;
}

function renderDevcontainerConfig(resolvedWorkspace: ResolvedWorkspace): Record<string, unknown> {
  const workspaceFolder =
    resolvedWorkspace.execution.devcontainer?.workspaceFolder ??
    `/workspace/${resolvedWorkspace.manifest.metadata.name}`;

  return {
    build: {
      context: "..",
      dockerfile: "Dockerfile",
    },
    customizations: {
      vscode: {
        settings: {
          "terminal.integrated.defaultProfile.linux": "bash",
        },
      },
    },
    init: true,
    name: `${resolvedWorkspace.manifest.metadata.name}-workspace`,
    postCreateCommand: "bash .devcontainer/bootstrap.sh",
    remoteUser: resolvedWorkspace.execution.devcontainer?.remoteUser ?? "vscode",
    updateRemoteUserUID: true,
    workspaceFolder,
    workspaceMount: `source=\${localWorkspaceFolder},target=${workspaceFolder},type=bind,consistency=cached`,
  };
}

async function syncWorkspaceOverlay(workspaceRoot: string, taskRoot: string): Promise<void> {
  await mapWithConcurrency(
    workspaceOverlayPaths,
    OVERLAY_COPY_CONCURRENCY_LIMIT,
    async (relativePath) => {
      const sourcePath = resolveSafePath(workspaceRoot, relativePath, "workspace overlay source");
      if (!(await pathExists(sourcePath))) {
        return;
      }

      const destinationPath = resolveSafePath(taskRoot, relativePath, "workspace overlay target");
      await copyPath(sourcePath, destinationPath);
    },
  );

  const workspaceStatePaths = [
    path.join(workspaceStateDirName, "execution"),
    path.join(workspaceStateDirName, "lock.json"),
    path.join(workspaceStateDirName, "state.json"),
  ];

  await mapWithConcurrency(
    workspaceStatePaths,
    OVERLAY_COPY_CONCURRENCY_LIMIT,
    async (relativePath) => {
      const sourcePath = resolveSafePath(workspaceRoot, relativePath, "workspace state source");
      if (!(await pathExists(sourcePath))) {
        return;
      }

      const destinationPath = resolveSafePath(taskRoot, relativePath, "workspace state target");
      await copyPath(sourcePath, destinationPath);
    },
  );
}

async function copyPath(sourcePath: string, destinationPath: string): Promise<void> {
  await removeIfExists(destinationPath);
  const stats = await stat(sourcePath);
  await ensureDir(path.dirname(destinationPath));
  if (stats.isDirectory()) {
    await cp(sourcePath, destinationPath, { force: true, recursive: true });
    return;
  }
  await cp(sourcePath, destinationPath, { force: true });
}

function createTaskBranchName(
  branchPrefix: string | undefined,
  taskName: string,
  scope: string,
): string {
  const prefix = sanitizeSegment(branchPrefix ?? "task");
  const sanitizedTaskName = sanitizeSegment(taskName);
  return `${prefix}/${sanitizedTaskName}/${sanitizeSegment(scope)}`;
}

function prefixWorkingDirectory(command: string, workingDirectory: string): string {
  if (workingDirectory === "." || workingDirectory.length === 0) {
    return command;
  }

  return `cd ${quote([workingDirectory])} && ${command}`;
}

function sanitizeSegment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  const trimmed = trimEdgeCharacters(normalized, "-");
  return trimmed || "task";
}

function trimEdgeCharacters(value: string, character: string): string {
  let start = 0;
  let end = value.length;

  while (start < end && value[start] === character) {
    start += 1;
  }

  while (end > start && value[end - 1] === character) {
    end -= 1;
  }

  return value.slice(start, end);
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}

function buildBootstrapFailureMessage(
  repositoryName: string,
  command: string,
  error: unknown,
): string {
  const wrappedError = new MaestroError({
    code: "BOOTSTRAP_COMMAND_FAILED",
    message: `Bootstrap command failed for ${repositoryName} (command: ${command})`,
    cause: error,
  });

  const details = errorMessage(wrappedError);
  return details.includes(command) ? details : `${details}: command: ${command}`;
}

function escalateReportStatus(current: ReportStatus, candidate: ReportStatus): ReportStatus {
  if (current === "error" || current === candidate) {
    return current;
  }
  if (candidate === "error") {
    return "error";
  }
  return current === "ok" ? "warning" : current;
}
