import { cp, stat } from "node:fs/promises";
import path from "node:path";
import {
  ensureDir,
  mapWithConcurrency,
  pathExists,
  removeIfExists,
  resolveSafePath,
} from "../../utils/fs.js";
import { listRuntimeProjectionDirs } from "../../runtime/types.js";
import { workspaceDescriptorFileName } from "../workspace-descriptor.js";
import { workspaceStateDirName } from "../../workspace/state-directory.js";

const OVERLAY_COPY_CONCURRENCY_LIMIT = 4;

const workspaceOverlayPaths = [
  "maestro.yaml",
  "workspace",
  "agents",
  "skills",
  "workflows",
  "package.json",
  "README.md",
  ".gitignore",
  "overrides",
  ".claude",
  ".agents",
  ...listRuntimeProjectionDirs().filter(
    (dir) => !dir.startsWith(".claude/") && !dir.startsWith(".agents/"),
  ),
  ".devcontainer",
  "AGENTS.md",
  // Team-owned and optional; carried over when present, never generated.
  "CLAUDE.md",
  workspaceDescriptorFileName,
];

export async function syncWorkspaceOverlay(workspaceRoot: string, taskRoot: string): Promise<void> {
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
    // Keep relative links (e.g. `.claude/skills/<name>` -> `.agents/skills/<name>`) pointing
    // inside the task root instead of back at the main workspace.
    await cp(sourcePath, destinationPath, { force: true, recursive: true, verbatimSymlinks: true });
    return;
  }
  await cp(sourcePath, destinationPath, { force: true });
}
