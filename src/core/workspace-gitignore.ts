import path from "node:path";
import { pathExists, readText, writeText } from "../utils/fs.js";

const defaultWorkspaceGitignoreEntries = [
  "repos/",
  ".maestro/",
  ".codex/",
  ".claude/",
  ".opencode/",
  ".mcp.json",
  "node_modules/",
  ".devcontainer/",
];

export function renderDefaultWorkspaceGitignore(): string {
  return `${defaultWorkspaceGitignoreEntries.join("\n")}\n`;
}

export async function ensureWorkspaceGitignore(
  workspaceRoot: string,
  dryRun = false,
): Promise<boolean> {
  const gitignorePath = path.join(workspaceRoot, ".gitignore");
  if (!(await pathExists(gitignorePath))) {
    if (!dryRun) {
      await writeText(gitignorePath, renderDefaultWorkspaceGitignore());
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
