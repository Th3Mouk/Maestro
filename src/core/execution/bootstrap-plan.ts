import path from "node:path";
import { quote } from "shell-quote";
import type { RepositoryRef, ResolvedWorkspace } from "../../workspace/types.js";
import { mapWithConcurrency, resolveSafePath } from "../../utils/fs.js";
import { errorMessage, MaestroError } from "../errors.js";
import {
  asProjectionPosixPath,
  projectRepositoryPath,
} from "../projection/workspace-projections.js";
import { detectBootstrapCommands } from "./bootstrap-detection/command-detection.js";
import { detectToolchains } from "./bootstrap-detection/toolchain-detection.js";

export interface RepositoryBootstrapPlan {
  repository: RepositoryRef;
  repoRoot: string;
  repoPathFromWorkspaceRoot: string;
  commands: string[];
  toolchains: string[];
  skipped: boolean;
}

export async function buildBootstrapPlan(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  concurrencyLimit: number,
): Promise<RepositoryBootstrapPlan[]> {
  return mapWithConcurrency(
    resolvedWorkspace.repositories,
    concurrencyLimit,
    async (repository) => {
      const repoRoot = resolveSafePath(
        workspaceRoot,
        projectRepositoryPath(repository.name),
        "workspace repository path",
      );
      const commands = await detectBootstrapCommands(repository, repoRoot);
      return {
        commands,
        repoRoot,
        repoPathFromWorkspaceRoot: asProjectionPosixPath(path.relative(workspaceRoot, repoRoot)),
        repository,
        skipped: commands.length === 0 || repository.bootstrap?.enabled === false,
        toolchains: detectToolchains(commands),
      };
    },
  );
}

export function renderBootstrapScript(plan: RepositoryBootstrapPlan[]): string {
  const lines = [
    "#!/usr/bin/env bash",
    "set -euo pipefail",
    'WORKSPACE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"',
    "printf '%s\\n' \"Bootstrapping workspace dependencies from $WORKSPACE_ROOT\"",
    "",
  ];

  for (const entry of plan) {
    lines.push(`printf '%s\\n' ${quote([`==> ${entry.repository.name}`])}`);
    if (entry.skipped) {
      lines.push(
        `printf '%s\\n' ${quote([`Skipping ${entry.repository.name}: no bootstrap commands.`])}`,
      );
      lines.push("");
      continue;
    }

    for (const command of entry.commands) {
      lines.push(
        `(cd "$WORKSPACE_ROOT"/${quote([entry.repoPathFromWorkspaceRoot])} && ${command})`,
      );
    }
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export function buildBootstrapFailureMessage(
  repositoryName: string,
  command: string,
  error: unknown,
): string {
  const wrappedError = new MaestroError({
    code: "BOOTSTRAP_COMMAND_FAILED",
    message: `Bootstrap command failed for ${repositoryName} (command: ${command})`,
    cause: error,
  });

  const details = errorMessage(wrappedError);
  return details.includes(command) ? details : `${details}: command: ${command}`;
}
