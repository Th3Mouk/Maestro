import path from "node:path";
import { execa } from "execa";
import type { BootstrapReport, ReportStatus, TaskWorktreeReport } from "../report/types.js";
import type { RuntimeName } from "../runtime/types.js";
import type { ResolvedWorkspace } from "../workspace/types.js";
import { renderWorkspaceDescriptor, workspaceDescriptorFileName } from "./workspace-descriptor.js";
import { editorWorkspaceFileName, renderEditorWorkspace } from "./editor-workspace.js";
import {
  ensureDir,
  mapWithConcurrency,
  resolveSafePath,
  withWorkspaceLock,
  writeJson,
  writeText,
} from "../utils/fs.js";
import { getRepositoryReferenceBranch } from "../workspace/repositories.js";
import { getWorkspaceStateRoot, workspaceStateDirName } from "../workspace/state-directory.js";
import {
  buildBootstrapFailureMessage,
  buildBootstrapPlan,
  renderBootstrapScript,
} from "./execution/bootstrap-plan.js";
import {
  renderDevcontainerConfig,
  renderDevcontainerDockerfile,
} from "./execution/devcontainer.js";
import { createTaskBranchName, sanitizeSegment } from "./execution/task-worktree.js";
import { syncWorkspaceOverlay } from "./execution/workspace-overlay.js";

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

const REPOSITORY_CONCURRENCY_LIMIT = 4;

export async function projectExecutionSupport(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  dryRun = false,
): Promise<string[]> {
  const actions: string[] = [];
  const executionRoot = getWorkspaceStateRoot(workspaceRoot, "execution");
  const bootstrapPlan = await buildBootstrapPlan(
    workspaceRoot,
    resolvedWorkspace,
    REPOSITORY_CONCURRENCY_LIMIT,
  );

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
  const bootstrapPlan = await buildBootstrapPlan(
    workspaceRoot,
    resolvedWorkspace,
    REPOSITORY_CONCURRENCY_LIMIT,
  );
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

function escalateReportStatus(current: ReportStatus, candidate: ReportStatus): ReportStatus {
  if (current === "error" || current === candidate) {
    return current;
  }
  if (candidate === "error") {
    return "error";
  }
  return current === "ok" ? "warning" : current;
}
