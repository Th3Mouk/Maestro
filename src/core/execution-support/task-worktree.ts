import path from "node:path";
import type { TaskWorktreeReport } from "../../report/types.js";
import type { RuntimeName } from "../../runtime/types.js";
import {
  ensureDir,
  resolveSafePath,
  withWorkspaceLock,
  writeJson,
  writeText,
} from "../../utils/fs.js";
import { workspaceStateDirName } from "../../workspace/state-directory.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import { editorWorkspaceFileName, renderEditorWorkspace } from "../editor-workspace.js";
import { escalateStatus } from "../errors.js";
import {
  createDryRunTaskRepositories,
  createTaskWorktreeReport,
  createWorktreesDisabledIssue,
  mergeTaskRepositoryOutcomes,
  prepareTaskRepositories,
  prepareTaskWorkspaceRoot,
} from "../execution/task-worktree-execution.js";
import { sanitizeSegment } from "../execution/task-worktree.js";
import { syncWorkspaceOverlay } from "../execution/workspace-overlay.js";
import { renderWorkspaceDescriptor, workspaceDescriptorFileName } from "../workspace-descriptor.js";
import { getTaskWorktreesRoot } from "./worktree-root.js";

type ExecutionSupportGitAdapter = {
  hasGitMetadata: (repoRoot: string) => Promise<boolean>;
  ensureWorktree: (
    repoRoot: string,
    worktreePath: string,
    branchName: string,
    baseRef?: string,
    dryRun?: boolean,
  ) => Promise<"created" | "updated" | "unchanged">;
};

export async function prepareTaskWorktreeWithResolvedWorkspace(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  taskName: string,
  options: { dryRun?: boolean },
  context: { gitAdapter: ExecutionSupportGitAdapter },
  concurrencyLimit: number,
): Promise<TaskWorktreeReport> {
  const { gitAdapter } = context;
  const sanitizedTaskName = sanitizeSegment(taskName);
  const worktrees = resolvedWorkspace.execution.worktrees;
  const taskRoot = resolveSafePath(
    getTaskWorktreesRoot(workspaceRoot, resolvedWorkspace),
    sanitizedTaskName,
    "task worktree root",
  );
  const report = createTaskWorktreeReport(
    resolvedWorkspace.manifest.metadata.name,
    taskName,
    taskRoot,
  );

  if (!worktrees?.enabled) {
    report.status = "error";
    report.issues.push(createWorktreesDisabledIssue());
    return report;
  }

  if (options.dryRun) {
    report.repositories = createDryRunTaskRepositories({
      branchPrefix: worktrees.branchPrefix,
      repositories: resolvedWorkspace.repositories,
      taskName,
      taskRoot,
    });
    return report;
  }

  const taskRootIssue = await prepareTaskWorkspaceRoot({
    branchPrefix: worktrees.branchPrefix,
    gitAdapter,
    taskName,
    taskRoot,
    workspaceName: resolvedWorkspace.manifest.metadata.name,
    workspaceRoot,
  });
  if (taskRootIssue) {
    report.status = escalateStatus(report.status, "warning");
    report.issues.push(taskRootIssue);
  }

  await syncWorkspaceOverlay(workspaceRoot, taskRoot);
  await ensureDir(resolveSafePath(taskRoot, "repos", "task repositories root"));

  const repositoryOutcomes = await prepareTaskRepositories({
    branchPrefix: worktrees.branchPrefix,
    concurrencyLimit,
    gitAdapter,
    repositories: resolvedWorkspace.repositories,
    taskName,
    taskRoot,
    workspaceRoot,
  });
  if (repositoryOutcomes.some((outcome) => outcome.issue)) {
    report.status = escalateStatus(report.status, "warning");
  }
  mergeTaskRepositoryOutcomes(report, repositoryOutcomes);

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
