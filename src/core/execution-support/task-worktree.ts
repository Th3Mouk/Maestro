import path from "node:path";
import type { TaskWorktreeReport } from "../../report/types.js";
import type { RuntimeName } from "../../runtime/types.js";
import {
  ensureDir,
  pathExists,
  resolveSafePath,
  withWorkspaceLock,
  writeJson,
  writeText,
} from "../../utils/fs.js";
import type { RepositoryRef, ResolvedWorkspace } from "../../workspace/types.js";
import { escalateStatus } from "../errors.js";
import {
  createDryRunTaskRepositories,
  createTaskWorktreeReport,
  createWorktreesDisabledIssue,
  mergeTaskRepositoryOutcomes,
  prepareTaskRepositories,
  prepareTaskWorkspaceRoot,
  type TaskWorktreeGitAdapter,
} from "../execution/task-worktree-execution.js";
import { fingerprintGeneratedFiles } from "../execution/task-worktree-generated-files.js";
import { sanitizeSegment } from "../execution/task-worktree.js";
import {
  getTaskWorktreeMetadataPath,
  listTaskRepositoryNames,
  readTaskWorktreeMetadata,
  type TaskWorktreeMetadata,
} from "../execution/task-worktree-metadata.js";
import { isWorkspaceOverlayPath, syncWorkspaceOverlay } from "../execution/workspace-overlay.js";
import {
  listWorktreeHookCommands,
  planWorktreeHooks,
  runWorktreeHooks,
} from "../execution/worktree-hooks.js";
import { getTaskEditorWorkspaceFileName, renderEditorWorkspace } from "../editor-workspace.js";
import { renderWorkspaceDescriptor, workspaceDescriptorFileName } from "../workspace-descriptor.js";
import { getTaskWorktreesRoot } from "./worktree-root.js";

export type ExecutionSupportGitAdapter = TaskWorktreeGitAdapter & {
  listUncommittedChanges: (repoRoot: string) => Promise<string[]>;
};

export interface TaskWorktreeCreateOptions {
  dryRun?: boolean;
  /** `false` skips the `postCreate` hooks. */
  hooks?: boolean;
  offline?: boolean;
  repos?: string[];
}

export async function prepareTaskWorktreeWithResolvedWorkspace(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  taskName: string,
  options: TaskWorktreeCreateOptions,
  context: { gitAdapter: ExecutionSupportGitAdapter; stderr?: NodeJS.WritableStream },
  concurrencyLimit: number,
): Promise<TaskWorktreeReport> {
  const { gitAdapter } = context;
  const hookCommands =
    options.hooks === false ? [] : listWorktreeHookCommands(resolvedWorkspace, "postCreate");
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

  const selection = selectTaskRepositories(resolvedWorkspace.repositories, options.repos);
  if (selection.unknown.length > 0) {
    report.status = "error";
    report.issues.push(...selection.unknown.map(createUnknownRepositoryIssue));
    return report;
  }

  if (options.dryRun) {
    report.repositories = createDryRunTaskRepositories({
      branchPrefix: worktrees.branchPrefix,
      repositories: selection.repositories,
      taskName,
      taskRoot,
    });
    if (hookCommands.length > 0) {
      report.hooks = planWorktreeHooks(hookCommands, "postCreate");
    }
    return report;
  }

  const taskRootExisted = await pathExists(taskRoot);
  // Read before the overlay sync, which replaces the task's `.maestro/execution/`.
  const previousMetadata = await readTaskWorktreeMetadata(taskRoot);
  const previousRepositories = taskRootExisted
    ? await listTaskRepositoryNames(taskRoot, previousMetadata)
    : [];

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
    offline: options.offline,
    repositories: selection.repositories,
    taskName,
    taskRoot,
    workspaceRoot,
  });
  if (repositoryOutcomes.some((outcome) => outcome.issue)) {
    report.status = escalateStatus(report.status, "warning");
  }
  mergeTaskRepositoryOutcomes(report, repositoryOutcomes);

  // A later `create --repos` only adds repositories: the ones already in the task stay recorded.
  const taskRepositoryNames = orderByManifest(resolvedWorkspace.repositories, [
    ...previousRepositories,
    ...report.repositories.map((repository) => repository.name),
  ]);

  const editorWorkspaceFile = getTaskEditorWorkspaceFileName(sanitizedTaskName);
  await withWorkspaceLock(taskRoot, async () => {
    // Lists the workspace root and only the repositories this task holds.
    await writeText(
      path.join(taskRoot, editorWorkspaceFile),
      renderEditorWorkspace({
        repositories: resolvedWorkspace.repositories.filter((repository) =>
          taskRepositoryNames.includes(repository.name),
        ),
        workspaceName: resolvedWorkspace.manifest.metadata.name,
      }),
    );
    await writeText(
      path.join(taskRoot, workspaceDescriptorFileName),
      renderWorkspaceDescriptor({
        execution: resolvedWorkspace.execution,
        repositories: resolvedWorkspace.repositories.filter((repository) =>
          taskRepositoryNames.includes(repository.name),
        ),
        runtimeNames: Object.keys(resolvedWorkspace.runtimes) as RuntimeName[],
        workspaceName: resolvedWorkspace.manifest.metadata.name,
      }),
    );
    const metadata: TaskWorktreeMetadata = {
      name: taskName,
      createdAt: previousMetadata?.createdAt ?? new Date().toISOString(),
      root: taskRoot,
      repositories: taskRepositoryNames,
      generatedFiles: await fingerprintTaskRootGeneratedFiles(gitAdapter, taskRoot, [
        workspaceDescriptorFileName,
        editorWorkspaceFile,
      ]),
    };
    await writeJson(getTaskWorktreeMetadataPath(taskRoot), metadata);
  });

  // Setup runs for a new task and when checkouts were added, not on a create that changed nothing.
  const checkoutsAdded = report.repositories.some(
    (repository) => repository.status !== "unchanged",
  );
  if (hookCommands.length > 0 && (!taskRootExisted || checkoutsAdded)) {
    const { failure, runs } = await runWorktreeHooks(hookCommands, {
      hook: "postCreate",
      stderr: context.stderr ?? process.stderr,
      task: {
        name: previousMetadata?.name ?? taskName,
        repositories: taskRepositoryNames,
        root: taskRoot,
      },
      trigger: "create",
      workspaceRoot,
    });
    report.hooks = runs;
    if (failure) {
      // The worktree stays: it is usable, only its setup failed.
      report.status = escalateStatus(report.status, "warning");
      report.issues.push({ code: "HOOK_FAILED", message: failure.message, path: taskRoot });
    }
  }

  return report;
}

/**
 * Records the descriptor, editor workspace file, and overlay copies that differ from the task branch right after
 * Maestro wrote them, so they do not make the task look dirty to `remove` and `prune`.
 */
async function fingerprintTaskRootGeneratedFiles(
  gitAdapter: ExecutionSupportGitAdapter,
  taskRoot: string,
  generatedRootFiles: string[],
): Promise<TaskWorktreeMetadata["generatedFiles"]> {
  if (!(await gitAdapter.hasGitMetadata(taskRoot))) {
    return undefined;
  }
  const changes = await gitAdapter.listUncommittedChanges(taskRoot);
  return fingerprintGeneratedFiles(
    taskRoot,
    changes.filter(
      (relativePath) =>
        generatedRootFiles.includes(relativePath) || isWorkspaceOverlayPath(relativePath),
    ),
  );
}

function selectTaskRepositories(
  repositories: RepositoryRef[],
  requested: string[] | undefined,
): { repositories: RepositoryRef[]; unknown: string[] } {
  if (!requested) {
    return { repositories, unknown: [] };
  }

  const known = new Set(repositories.map((repository) => repository.name));
  return {
    repositories: repositories.filter((repository) => requested.includes(repository.name)),
    unknown: requested.filter((name) => !known.has(name)),
  };
}

function createUnknownRepositoryIssue(name: string): TaskWorktreeReport["issues"][number] {
  return {
    code: "REPO_UNKNOWN",
    message: `Repository "${name}" is not declared in the workspace manifest.`,
  };
}

/** Deduplicates names, manifest order first, then names the manifest no longer declares. */
function orderByManifest(repositories: RepositoryRef[], names: string[]): string[] {
  const unique = new Set(names);
  const declared = repositories
    .map((repository) => repository.name)
    .filter((name) => unique.has(name));
  return [...declared, ...[...unique].filter((name) => !declared.includes(name))];
}
