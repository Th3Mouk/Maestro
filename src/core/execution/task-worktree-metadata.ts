import path from "node:path";
import { readFile } from "node:fs/promises";
import { listDirectories, resolveSafePath } from "../../utils/fs.js";
import { workspaceStateDirName } from "../../workspace/state-directory.js";
import type { GeneratedFileFingerprints } from "./task-worktree-generated-files.js";

export interface TaskWorktreeMetadata {
  createdAt: string;
  /** Files Maestro wrote into the task root that differ from the task branch. */
  generatedFiles?: GeneratedFileFingerprints;
  name: string;
  /** Repositories that have a worktree in this task. Absent in metadata written before 0.7. */
  repositories?: string[];
  root: string;
}

export function getTaskWorktreeMetadataPath(taskRoot: string): string {
  return path.join(taskRoot, workspaceStateDirName, "execution", "worktree.json");
}

export async function readTaskWorktreeMetadata(
  taskRoot: string,
): Promise<Partial<TaskWorktreeMetadata> | undefined> {
  try {
    const raw = await readFile(getTaskWorktreeMetadataPath(taskRoot), "utf8");
    return JSON.parse(raw) as Partial<TaskWorktreeMetadata>;
  } catch {
    return undefined;
  }
}

/**
 * The repositories a task holds: the recorded list, or, for metadata that predates it,
 * every directory present under `<taskRoot>/repos/`.
 */
export async function listTaskRepositoryNames(
  taskRoot: string,
  metadata: Partial<TaskWorktreeMetadata> | undefined,
): Promise<string[]> {
  if (Array.isArray(metadata?.repositories)) {
    return metadata.repositories;
  }

  return listDirectories(resolveSafePath(taskRoot, "repos", "task repositories root"));
}
