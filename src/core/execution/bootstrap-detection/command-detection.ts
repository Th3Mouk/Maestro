import { readFile } from "node:fs/promises";
import path from "node:path";
import { quote } from "shell-quote";
import type { RepositoryRef } from "../../../workspace/types.js";
import { pathExists, resolveSafePath } from "../../../utils/fs.js";

export async function detectBootstrapCommands(
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

function prefixWorkingDirectory(command: string, workingDirectory: string): string {
  if (workingDirectory === "." || workingDirectory.length === 0) {
    return command;
  }

  return `cd ${quote([workingDirectory])} && ${command}`;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
