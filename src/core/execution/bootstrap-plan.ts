import path from "node:path";
import { quote } from "shell-quote";
import type { BootstrapReport } from "../../report/types.js";
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
  issues: BootstrapReport["issues"];
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
      const detection = await detectBootstrapCommands(repository, repoRoot);
      return {
        commands: detection.commands,
        issues: detection.issues,
        repoRoot,
        repoPathFromWorkspaceRoot: asProjectionPosixPath(path.relative(workspaceRoot, repoRoot)),
        repository,
        skipped: detection.commands.length === 0,
        toolchains: detectToolchains(detection.commands),
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
    for (const issue of entry.issues) {
      lines.push(`printf '%s\\n' ${quote([`Warning: ${issue.message}`])}`);
    }
    if (entry.skipped) {
      if (entry.issues.length === 0) {
        lines.push(
          `printf '%s\\n' ${quote([`Skipping ${entry.repository.name}: no bootstrap commands.`])}`,
        );
      }
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
