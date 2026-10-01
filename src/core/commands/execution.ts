import path from "node:path";
import {
  bootstrapWorkspace as bootstrapWorkspaceExecution,
  prepareTaskWorktree,
} from "../execution-service.js";
import type {
  TaskWorktreeReport,
  WorktreeListReport,
  WorktreePruneReport,
  WorktreeRemoveReport,
} from "../../report/types.js";
import { loadWorkspaceManifest, resolveWorkspace } from "../workspace-service.js";
import { resolveMainWorkspaceRoot } from "../execution-support/main-workspace.js";
import { removeTaskWorktreeWithResolvedWorkspace } from "../execution-support/task-worktree-remove.js";
import { listTaskWorktreesWithResolvedWorkspace } from "../execution-support/task-worktree-list.js";
import {
  pruneTaskWorktreesWithResolvedWorkspace,
  type PruneOptions,
} from "../execution-support/task-worktree-prune.js";
import { listWorkspaceRepositoriesWithResolvedWorkspace } from "../execution-support/repository-list.js";
import type { CommandContext } from "../command-context.js";
import { createCommandContext } from "../command-context.js";

interface LoopProgressReporter {
  complete: () => void;
  itemCompleted: () => void;
  itemStarted: (label: string, index: number) => void;
  phase: (message: string) => void;
}

export function createLoopProgressReporter(
  stream: NodeJS.WriteStream,
  operation: string,
  total: number,
): LoopProgressReporter {
  let completed = 0;

  const writeLine = (message: string) => {
    stream.write(`[maestro] ${operation}: ${message}\n`);
  };

  return {
    itemStarted: (label, index) => {
      writeLine(`[${index + 1}/${total}] start ${label}`);
    },
    itemCompleted: () => {
      completed += 1;
      writeLine(`completed ${completed}/${total}`);
    },
    phase: (message) => {
      writeLine(message);
    },
    complete: () => {
      writeLine(`done (${completed}/${total})`);
    },
  };
}

export async function bootstrapWorkspace(
  workspaceRoot: string,
  options: { repository?: string; dryRun?: boolean } = {},
) {
  return bootstrapWorkspaceExecution(workspaceRoot, options);
}

export async function createTaskWorktree(
  workspaceRoot: string,
  taskName: string,
  options: { dryRun?: boolean; offline?: boolean; repos?: string[] } = {},
  context: CommandContext = createCommandContext(),
): Promise<TaskWorktreeReport> {
  const resolution = await resolveMainWorkspaceRoot(workspaceRoot);
  if ("error" in resolution) {
    return {
      status: "error",
      workspace: await readWorkspaceName(workspaceRoot),
      name: taskName,
      root: workspaceRoot,
      repositories: [],
      issues: [resolution.error],
    };
  }

  const report = await prepareTaskWorktree(resolution.workspaceRoot, taskName, options, {
    gitAdapter: context.gitAdapter,
  });
  return withResolutionIssue(report, resolution.issue);
}

export async function removeTaskWorktree(
  workspaceRoot: string,
  taskName: string,
  options: { force?: boolean; dryRun?: boolean } = {},
  context: CommandContext = createCommandContext(),
): Promise<WorktreeRemoveReport> {
  const resolution = await resolveMainWorkspaceRoot(workspaceRoot);
  if ("error" in resolution) {
    return {
      status: "error",
      workspace: await readWorkspaceName(workspaceRoot),
      name: taskName,
      root: workspaceRoot,
      repositories: [],
      workspaceRootStatus: "skipped",
      issues: [resolution.error],
    };
  }

  const resolvedWorkspace = await resolveWorkspace(resolution.workspaceRoot);
  const report = await removeTaskWorktreeWithResolvedWorkspace(
    resolution.workspaceRoot,
    resolvedWorkspace,
    taskName,
    options,
    { gitAdapter: context.gitAdapter },
    4,
  );
  return withResolutionIssue(report, resolution.issue);
}

export async function listTaskWorktrees(
  workspaceRoot: string,
  options: { status?: boolean } = {},
  context: CommandContext = createCommandContext(),
): Promise<WorktreeListReport> {
  const resolution = await resolveMainWorkspaceRoot(workspaceRoot);
  if ("error" in resolution) {
    return {
      status: "error",
      workspace: await readWorkspaceName(workspaceRoot),
      worktrees: [],
      issues: [resolution.error],
    };
  }

  const resolvedWorkspace = await resolveWorkspace(resolution.workspaceRoot);
  const report = await listTaskWorktreesWithResolvedWorkspace(
    resolution.workspaceRoot,
    resolvedWorkspace,
    options,
    { gitAdapter: context.gitAdapter },
  );
  return withResolutionIssue(report, resolution.issue);
}

export async function pruneTaskWorktrees(
  workspaceRoot: string,
  options: PruneOptions = {},
  context: CommandContext = createCommandContext(),
): Promise<WorktreePruneReport> {
  const resolution = await resolveMainWorkspaceRoot(workspaceRoot);
  if ("error" in resolution) {
    return {
      status: "error",
      workspace: await readWorkspaceName(workspaceRoot),
      dryRun: options.dryRun ?? false,
      removed: [],
      deletedBranches: [],
      kept: [],
      issues: [resolution.error],
    };
  }

  const resolvedWorkspace = await resolveWorkspace(resolution.workspaceRoot);
  const report = await pruneTaskWorktreesWithResolvedWorkspace(
    resolution.workspaceRoot,
    resolvedWorkspace,
    options,
    { gitAdapter: context.gitAdapter },
    4,
  );
  return withResolutionIssue(report, resolution.issue);
}

function withResolutionIssue<Report extends { issues: Array<{ code: string; message: string }> }>(
  report: Report,
  issue: Report["issues"][number] | undefined,
): Report {
  if (issue) {
    report.issues.unshift(issue);
  }
  return report;
}

async function readWorkspaceName(workspaceRoot: string): Promise<string> {
  try {
    return (await loadWorkspaceManifest(workspaceRoot)).metadata.name;
  } catch {
    return path.basename(workspaceRoot);
  }
}

export async function listWorkspaceRepositories(workspaceRoot: string) {
  const resolvedWorkspace = await resolveWorkspace(workspaceRoot);
  return listWorkspaceRepositoriesWithResolvedWorkspace(workspaceRoot, resolvedWorkspace);
}
