import { readFile } from "node:fs/promises";
import path from "node:path";
import { quote } from "shell-quote";
import type { RepositoryRef, ResolvedWorkspace } from "../../workspace/types.js";
import { mapWithConcurrency, pathExists, resolveSafePath } from "../../utils/fs.js";
import { errorMessage, MaestroError } from "../errors.js";

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
        path.join("repos", repository.name),
        "workspace repository path",
      );
      const commands = await detectBootstrapCommands(repository, repoRoot);
      return {
        commands,
        repoRoot,
        repoPathFromWorkspaceRoot: toPosixPath(path.relative(workspaceRoot, repoRoot)),
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

async function detectBootstrapCommands(
  repository: RepositoryRef,
  repoRoot: string,
): Promise<string[]> {
  const workingDirectory = repository.bootstrap?.workingDirectory ?? ".";

  if (repository.bootstrap?.enabled === false) {
    return [];
  }

  if (repository.bootstrap?.strategy === "manual") {
    return dedupe(repository.bootstrap.commands ?? []).map((command) =>
      prefixWorkingDirectory(command, workingDirectory),
    );
  }

  const commands = [...(repository.bootstrap?.commands ?? [])];
  const root = resolveSafePath(repoRoot, workingDirectory, "bootstrap workingDirectory");

  if (!(await pathExists(root))) {
    return commands;
  }

  const [hasComposer, hasPackageJson, hasPyproject, hasUvLock, hasRequirements] = await Promise.all(
    [
      pathExists(path.join(root, "composer.json")),
      pathExists(path.join(root, "package.json")),
      pathExists(path.join(root, "pyproject.toml")),
      pathExists(path.join(root, "uv.lock")),
      pathExists(path.join(root, "requirements.txt")),
    ],
  );

  if (hasComposer) {
    commands.push("composer install --no-interaction --prefer-dist");
  }

  if (hasUvLock) {
    commands.push("uv sync");
  } else if (hasPyproject && (await pyprojectMentionsUv(path.join(root, "pyproject.toml")))) {
    commands.push("uv sync");
  } else if (hasRequirements) {
    commands.push(
      "python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt",
    );
  }

  if (hasPackageJson) {
    commands.push(await detectNodeInstallCommand(root));
  }

  return dedupe(commands).map((command) => prefixWorkingDirectory(command, workingDirectory));
}

async function detectNodeInstallCommand(repoRoot: string): Promise<string> {
  const [hasPnpmLock, hasYarnLock, hasBunLockb, hasBunLock, hasPackageLock] = await Promise.all([
    pathExists(path.join(repoRoot, "pnpm-lock.yaml")),
    pathExists(path.join(repoRoot, "yarn.lock")),
    pathExists(path.join(repoRoot, "bun.lockb")),
    pathExists(path.join(repoRoot, "bun.lock")),
    pathExists(path.join(repoRoot, "package-lock.json")),
  ]);

  if (hasPnpmLock) {
    return "corepack enable >/dev/null 2>&1 || true; pnpm install --frozen-lockfile || pnpm install";
  }

  if (hasYarnLock) {
    return "corepack enable >/dev/null 2>&1 || true; yarn install --immutable || yarn install";
  }

  if (hasBunLockb || hasBunLock) {
    return "bun install";
  }

  if (hasPackageLock) {
    return "npm ci || npm install";
  }

  return "npm install";
}

async function pyprojectMentionsUv(pyprojectPath: string): Promise<boolean> {
  if (!(await pathExists(pyprojectPath))) {
    return false;
  }

  const content = await readFile(pyprojectPath, "utf8");
  return content.includes("[tool.uv]") || content.includes("[project]");
}

function detectToolchains(commands: string[]): string[] {
  const tools = new Set<string>();
  for (const command of commands) {
    if (command.includes("composer ")) {
      tools.add("php");
      tools.add("composer");
    }
    if (command.includes("uv ")) {
      tools.add("python");
      tools.add("uv");
    }
    if (command.includes("python3 ") || command.includes("pip install")) {
      tools.add("python");
    }
    if (
      command.includes("pnpm ") ||
      command.includes("yarn ") ||
      command.includes("npm ") ||
      command.includes("bun ")
    ) {
      tools.add("node");
    }
  }
  return [...tools].sort((left, right) => left.localeCompare(right));
}

function prefixWorkingDirectory(command: string, workingDirectory: string): string {
  if (workingDirectory === "." || workingDirectory.length === 0) {
    return command;
  }

  return `cd ${quote([workingDirectory])} && ${command}`;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}
