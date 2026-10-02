import path from "node:path";
import {
  bootstrapWorkspace as bootstrapWorkspaceExecution,
  prepareTaskWorktree,
} from "../execution-service.js";
import type {
  TaskWorktreeReport,
  WorktreeListReport,
  WorktreeOpenReport,
  WorktreePruneReport,
  WorktreeRemoveReport,
} from "../../report/types.js";
import { loadWorkspaceManifest, resolveWorkspace } from "../workspace-service.js";
import { resolveMainWorkspaceRoot } from "../execution-support/main-workspace.js";
import {
  removeTaskWorktreeWithResolvedWorkspace,
  type TaskWorktreeRemoveOptions,
} from "../execution-support/task-worktree-remove.js";
import type { TaskWorktreeCreateOptions } from "../execution-support/task-worktree.js";
import { listTaskWorktreesWithResolvedWorkspace } from "../execution-support/task-worktree-list.js";
import {
  pruneTaskWorktreesWithResolvedWorkspace,
  type PruneOptions,
} from "../execution-support/task-worktree-prune.js";
import { listWorkspaceRepositoriesWithResolvedWorkspace } from "../execution-support/repository-list.js";
import {
  launchTaskEditor,
  locateTaskWorktree,
  type TaskLocation,
  type TaskPicker,
} from "../execution-support/task-worktree-open.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import type { ForgeName } from "../../adapters/forge/github-forge.js";
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
  options: TaskWorktreeCreateOptions = {},
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
    stderr: context.stderr,
  });
  return withResolutionIssue(report, resolution.issue);
}

export async function removeTaskWorktree(
  workspaceRoot: string,
  taskName: string,
  options: TaskWorktreeRemoveOptions = {},
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
    { gitAdapter: context.gitAdapter, stderr: context.stderr },
    4,
  );
  return withResolutionIssue(report, resolution.issue);
}

export async function listTaskWorktrees(
  workspaceRoot: string,
  options: { forge?: ForgeName | "none"; status?: boolean } = {},
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
    { forgeClients: context.forgeClients, gitAdapter: context.gitAdapter },
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
    { forgeClients: context.forgeClients, gitAdapter: context.gitAdapter, stderr: context.stderr },
    4,
  );
  return withResolutionIssue(report, resolution.issue);
}

/** `worktree path`: the root of a task, `@root` for the main workspace, or a picked one. */
export async function getTaskWorktreePath(
  workspaceRoot: string,
  task: string | undefined,
  options: { pick?: TaskPicker } = {},
  context: CommandContext = createCommandContext(),
): Promise<WorktreeOpenReport> {
  return (await locateForCommand(workspaceRoot, task, options, context)).report;
}

/**
 * `worktree open`: locates the task like `worktree path` (with `create`, creating a missing
 * task first, hooks included), then opens it in the editor.
 */
export async function openTaskWorktree(
  workspaceRoot: string,
  task: string | undefined,
  options: {
    create?: boolean;
    editor?: string;
    env?: NodeJS.ProcessEnv;
    pick?: TaskPicker;
    platform?: NodeJS.Platform;
  } = {},
  context: CommandContext = createCommandContext(),
): Promise<WorktreeOpenReport> {
  let located = await locateForCommand(workspaceRoot, task, options, context);
  let created: TaskWorktreeReport | undefined;
  const missing = located.report.issues.some((issue) => issue.code === "WORKTREE_NOT_FOUND");
  if (options.create && task !== undefined && missing) {
    created = await createTaskWorktree(workspaceRoot, task, {}, context);
    if (created.status === "error") {
      return { ...located.report, created, issues: created.issues };
    }
    located = await locateForCommand(workspaceRoot, task, options, context);
  }

  const { location, report, resolvedWorkspace } = located;
  if (created) {
    report.created = created;
  }
  if (!location || !resolvedWorkspace) {
    return report;
  }
  await launchTaskEditor(report, location, {
    editor: options.editor,
    env: options.env ?? process.env,
    launcher: context.launchEditor,
    manifestEditor: resolvedWorkspace.execution.worktrees?.editor,
    platform: options.platform ?? process.platform,
  });
  return report;
}

async function locateForCommand(
  workspaceRoot: string,
  task: string | undefined,
  options: { pick?: TaskPicker },
  context: CommandContext,
): Promise<{
  location?: TaskLocation;
  report: WorktreeOpenReport;
  resolvedWorkspace?: ResolvedWorkspace;
}> {
  const resolution = await resolveMainWorkspaceRoot(workspaceRoot);
  if ("error" in resolution) {
    return {
      report: {
        status: "error",
        workspace: await readWorkspaceName(workspaceRoot),
        name: task ?? "",
        root: "",
        issues: [resolution.error],
      },
    };
  }

  const resolvedWorkspace = await resolveWorkspace(resolution.workspaceRoot);
  const report: WorktreeOpenReport = {
    status: "ok",
    workspace: resolvedWorkspace.manifest.metadata.name,
    name: task ?? "",
    root: "",
    issues: [],
  };
  const location = await locateTaskWorktree(
    resolution.workspaceRoot,
    resolvedWorkspace,
    task,
    options,
    context,
  );
  if ("issue" in location) {
    report.status = "error";
    report.issues.push(location.issue);
    return { report, resolvedWorkspace };
  }
  report.name = location.name;
  report.root = location.target.root;
  return { location, report: withResolutionIssue(report, resolution.issue), resolvedWorkspace };
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
