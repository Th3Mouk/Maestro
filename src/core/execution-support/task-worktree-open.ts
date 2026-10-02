import path from "node:path";
import type { WorktreeOpenReport } from "../../report/types.js";
import { pathExists, resolveSafePath } from "../../utils/fs.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import { editorWorkspaceFileName, getTaskEditorWorkspaceFileName } from "../editor-workspace.js";
import { errorMessage } from "../errors.js";
import {
  buildEditorLaunch,
  describeEditorLaunch,
  resolveEditorId,
  type EditorLaunch,
  type EditorTarget,
} from "../execution/editor-launch.js";
import { sanitizeSegment } from "../execution/task-worktree.js";
import { readTaskWorktreeMetadata } from "../execution/task-worktree-metadata.js";
import {
  listTaskWorktreesWithResolvedWorkspace,
  type TaskWorktreeListGitAdapter,
} from "./task-worktree-list.js";
import { buildTaskRows, mainWorkspaceTaskName, type TaskRow } from "./task-worktree-rows.js";
import { getTaskWorktreesRoot } from "./worktree-root.js";

/** Lets the user choose a task interactively; `undefined` when they cancel. */
export type TaskPicker = (rows: TaskRow[]) => Promise<string | undefined>;

/** Starts an editor process; rejects when it cannot be started or exits non-zero. */
type EditorLauncher = (launch: EditorLaunch) => Promise<void>;

type Issue = WorktreeOpenReport["issues"][number];

export interface TaskLocation {
  name: string;
  target: EditorTarget;
}

/**
 * The root of `task` (`@root` is the main workspace). Without a task, `pick` chooses one from
 * the `list --status` rows; without a picker either (no TTY), the task is required.
 */
export async function locateTaskWorktree(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  task: string | undefined,
  options: { pick?: TaskPicker },
  context: { gitAdapter: TaskWorktreeListGitAdapter },
): Promise<TaskLocation | { issue: Issue }> {
  let name = task;
  if (name === undefined) {
    if (!options.pick) {
      return {
        issue: {
          code: "TASK_REQUIRED",
          message: "Name the task (or @root for the main workspace); the picker needs a terminal.",
        },
      };
    }
    const listed = await listTaskWorktreesWithResolvedWorkspace(
      workspaceRoot,
      resolvedWorkspace,
      { status: true },
      context,
    );
    name = await options.pick(
      buildTaskRows(listed, {
        allRepositories: resolvedWorkspace.repositories.map((repository) => repository.name),
      }),
    );
    if (name === undefined) {
      return { issue: { code: "TASK_NOT_SELECTED", message: "No task selected." } };
    }
  }

  if (name === mainWorkspaceTaskName) {
    const workspaceFile = path.join(workspaceRoot, editorWorkspaceFileName);
    return {
      name,
      target: {
        root: workspaceRoot,
        ...((await pathExists(workspaceFile)) ? { workspaceFile } : {}),
      },
    };
  }

  const directoryName = sanitizeSegment(name);
  const root = resolveSafePath(
    getTaskWorktreesRoot(workspaceRoot, resolvedWorkspace),
    directoryName,
    "task worktree root",
  );
  const metadata = await readTaskWorktreeMetadata(root);
  if (!metadata) {
    return {
      issue: (await pathExists(root))
        ? {
            code: "WORKTREE_FOREIGN",
            message: `${root} is not a Maestro task worktree.`,
            path: root,
          }
        : { code: "WORKTREE_NOT_FOUND", message: `No task worktree "${name}".`, path: root },
    };
  }

  const workspaceFile = path.join(root, getTaskEditorWorkspaceFileName(directoryName));
  return {
    name: metadata.name ?? name,
    target: { root, ...((await pathExists(workspaceFile)) ? { workspaceFile } : {}) },
  };
}

/** Opens the located task in the resolved editor, recording the launch in the report. */
export async function launchTaskEditor(
  report: WorktreeOpenReport,
  location: TaskLocation,
  options: {
    editor?: string;
    env: NodeJS.ProcessEnv;
    launcher: EditorLauncher;
    manifestEditor?: string;
    platform: NodeJS.Platform;
  },
): Promise<void> {
  const editor = resolveEditorId(options.editor, options.env, options.manifestEditor);
  report.editor = editor;

  let launch: EditorLaunch | undefined;
  try {
    launch = await buildEditorLaunch(editor, location.target, options);
  } catch (error) {
    report.status = "error";
    report.issues.push({ code: "EDITOR_UNKNOWN", message: errorMessage(error) });
    return;
  }
  if (!launch) {
    return;
  }

  report.launch = describeEditorLaunch(launch);
  try {
    await options.launcher(launch);
  } catch (error) {
    report.status = "error";
    report.issues.push({
      code: "EDITOR_UNAVAILABLE",
      message: `Could not open ${editor} with \`${report.launch}\`: ${errorMessage(error)}`,
    });
  }
}
