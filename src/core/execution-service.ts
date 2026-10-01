import type { BootstrapReport, TaskWorktreeReport } from "../report/types.js";
import type { ResolvedWorkspace } from "../workspace/types.js";
import { bootstrapWorkspaceWithResolvedWorkspace } from "./execution-support/bootstrap-workspace.js";
import {
  projectEditorWorkspaceWithResolvedWorkspace,
  projectExecutionSupportWithResolvedWorkspace,
} from "./execution-support/project-execution-support.js";
import {
  prepareTaskWorktreeWithResolvedWorkspace,
  type ExecutionSupportGitAdapter,
} from "./execution-support/task-worktree.js";

export type ExecutionGitAdapter = ExecutionSupportGitAdapter;

interface ExecutionServiceContext {
  gitAdapter: ExecutionGitAdapter;
}

const REPOSITORY_CONCURRENCY_LIMIT = 4;

export async function projectExecutionSupport(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  dryRun = false,
): Promise<string[]> {
  return projectExecutionSupportWithResolvedWorkspace(
    workspaceRoot,
    resolvedWorkspace,
    REPOSITORY_CONCURRENCY_LIMIT,
    dryRun,
  );
}

export async function projectEditorWorkspace(workspaceRoot: string, dryRun = false): Promise<void> {
  const { resolveWorkspace } = await import("./workspace-service.js");
  const resolvedWorkspace = await resolveWorkspace(workspaceRoot);
  await projectEditorWorkspaceWithResolvedWorkspace(workspaceRoot, resolvedWorkspace, dryRun);
}

export async function bootstrapWorkspace(
  workspaceRoot: string,
  options: { repository?: string; dryRun?: boolean } = {},
): Promise<BootstrapReport> {
  const { resolveWorkspace } = await import("./workspace-service.js");
  const resolvedWorkspace = await resolveWorkspace(workspaceRoot);
  return bootstrapWorkspaceWithResolvedWorkspace(
    workspaceRoot,
    resolvedWorkspace,
    options,
    REPOSITORY_CONCURRENCY_LIMIT,
  );
}

export async function prepareTaskWorktree(
  workspaceRoot: string,
  taskName: string,
  options: { dryRun?: boolean; repos?: string[] } = {},
  context: ExecutionServiceContext,
): Promise<TaskWorktreeReport> {
  const { resolveWorkspace } = await import("./workspace-service.js");
  const resolvedWorkspace = await resolveWorkspace(workspaceRoot);
  return prepareTaskWorktreeWithResolvedWorkspace(
    workspaceRoot,
    resolvedWorkspace,
    taskName,
    options,
    context,
    REPOSITORY_CONCURRENCY_LIMIT,
  );
}
