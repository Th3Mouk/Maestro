import path from "node:path";
import { listRuntimeProjectionDirs } from "../runtime/types.js";
import { pathExists, readText, writeText } from "../utils/fs.js";
import type { ResolvedWorkspace } from "../workspace/types.js";

// Only the directories Maestro regenerates, and only for the projections that are active,
// so a team's own `.github/agents/` stays tracked when Copilot is not configured.
// Instruction files (AGENTS.md, CLAUDE.md), runtime settings, MCP, and hooks
// configuration stay versionable by the team.
function listDefaultWorkspaceGitignoreEntries(runtimes: ResolvedWorkspace["runtimes"]): string[] {
  return [
    "repos/",
    ".maestro/",
    ...listRuntimeProjectionDirs(runtimes).map((dir) => `${dir}/`),
    "node_modules/",
    ".devcontainer/",
  ];
}

export function renderDefaultWorkspaceGitignore(runtimes: ResolvedWorkspace["runtimes"]): string {
  return `${listDefaultWorkspaceGitignoreEntries(runtimes).join("\n")}\n`;
}

export async function ensureWorkspaceGitignore(
  workspaceRoot: string,
  runtimes: ResolvedWorkspace["runtimes"],
  dryRun = false,
): Promise<boolean> {
  const defaultWorkspaceGitignoreEntries = listDefaultWorkspaceGitignoreEntries(runtimes);
  const gitignorePath = path.join(workspaceRoot, ".gitignore");
  if (!(await pathExists(gitignorePath))) {
    if (!dryRun) {
      await writeText(gitignorePath, renderDefaultWorkspaceGitignore(runtimes));
    }
    return true;
  }

  const existingContent = await readText(gitignorePath);
  const existingEntries = new Set(
    existingContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
  const missingEntries = defaultWorkspaceGitignoreEntries.filter(
    (entry) => !existingEntries.has(entry),
  );

  if (missingEntries.length === 0 || dryRun) {
    return missingEntries.length > 0;
  }

  const separator = existingContent.endsWith("\n") || existingContent.length === 0 ? "" : "\n";
  const suffix = `${missingEntries.join("\n")}\n`;
  await writeText(gitignorePath, `${existingContent}${separator}${suffix}`);
  return true;
}
