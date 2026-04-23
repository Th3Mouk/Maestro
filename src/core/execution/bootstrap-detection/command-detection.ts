import { readFile } from "node:fs/promises";
import path from "node:path";
import { quote } from "shell-quote";
import type { BootstrapReport } from "../../../report/types.js";
import type { RepositoryRef } from "../../../workspace/types.js";
import { pathExists, resolveSafePath } from "../../../utils/fs.js";

export interface BootstrapCommandDetection {
  commands: string[];
  issues: BootstrapReport["issues"];
}

export async function detectBootstrapCommands(
  repository: RepositoryRef,
  repoRoot: string,
): Promise<BootstrapCommandDetection> {
  const workingDirectory = repository.bootstrap?.workingDirectory ?? ".";

  if (repository.bootstrap?.enabled === false) {
    return { commands: [], issues: [] };
  }

  if (repository.bootstrap?.strategy === "manual") {
    return {
      commands: dedupe(repository.bootstrap.commands ?? []).map((command) =>
        prefixWorkingDirectory(command, workingDirectory),
      ),
      issues: [],
    };
  }

  const commands = [...(repository.bootstrap?.commands ?? [])];
  const issues: BootstrapReport["issues"] = [];
  const root = resolveSafePath(repoRoot, workingDirectory, "bootstrap workingDirectory");

  if (!(await pathExists(root))) {
    return { commands, issues };
  }

  const [hasComposer, hasComposerLock, hasPackageJson, hasPyproject, hasUvLock, hasRequirements] =
    await Promise.all([
      pathExists(path.join(root, "composer.json")),
      pathExists(path.join(root, "composer.lock")),
      pathExists(path.join(root, "package.json")),
      pathExists(path.join(root, "pyproject.toml")),
      pathExists(path.join(root, "uv.lock")),
      pathExists(path.join(root, "requirements.txt")),
    ]);

  if (hasComposer) {
    if (hasComposerLock) {
      commands.push("composer install --no-interaction --prefer-dist");
    } else {
      issues.push({
        code: "BOOTSTRAP_LOCKFILE_REQUIRED",
        message: buildMissingLockfileMessage(
          repository.name,
          "composer.json",
          "composer.lock",
          "Auto bootstrap will not run Composer without a lockfile.",
        ),
        path: root,
      });
    }
  }

  if (hasUvLock) {
    commands.push("uv sync");
  } else if (hasPyproject && (await pyprojectMentionsUv(path.join(root, "pyproject.toml")))) {
    issues.push({
      code: "BOOTSTRAP_LOCKFILE_REQUIRED",
      message: buildMissingLockfileMessage(
        repository.name,
        "pyproject.toml",
        "uv.lock",
        "Auto bootstrap will not run uv without a lockfile.",
      ),
      path: root,
    });
  } else if (hasRequirements) {
    commands.push(
      "python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt",
    );
  }

  if (hasPackageJson) {
    const nodeInstall = await detectNodeInstallCommand(root);
    if (nodeInstall) {
      commands.push(nodeInstall);
    } else {
      issues.push({
        code: "BOOTSTRAP_LOCKFILE_REQUIRED",
        message: [
          `Auto bootstrap for ${repository.name} found package.json but no supported Node lockfile.`,
          "Expected one of package-lock.json, pnpm-lock.yaml, yarn.lock, bun.lock, or bun.lockb.",
          "Add a lockfile or switch spec.repositories[].bootstrap.strategy to manual.",
        ].join(" "),
        path: root,
      });
    }
  }

  return {
    commands: dedupe(commands).map((command) => prefixWorkingDirectory(command, workingDirectory)),
    issues,
  };
}

async function detectNodeInstallCommand(repoRoot: string): Promise<string | undefined> {
  const [hasPnpmLock, hasYarnLock, hasBunLockb, hasBunLock, hasPackageLock] = await Promise.all([
    pathExists(path.join(repoRoot, "pnpm-lock.yaml")),
    pathExists(path.join(repoRoot, "yarn.lock")),
    pathExists(path.join(repoRoot, "bun.lockb")),
    pathExists(path.join(repoRoot, "bun.lock")),
    pathExists(path.join(repoRoot, "package-lock.json")),
  ]);

  if (hasPnpmLock) {
    return "corepack enable >/dev/null 2>&1 || true; pnpm install --frozen-lockfile";
  }

  if (hasYarnLock) {
    return "corepack enable >/dev/null 2>&1 || true; yarn install --immutable";
  }

  if (hasBunLockb || hasBunLock) {
    return "bun install";
  }

  if (hasPackageLock) {
    return "npm ci";
  }
}

async function pyprojectMentionsUv(pyprojectPath: string): Promise<boolean> {
  const content = await readFile(pyprojectPath, "utf8");
  return content.includes("[tool.uv]");
}

function prefixWorkingDirectory(command: string, workingDirectory: string): string {
  if (workingDirectory === "." || workingDirectory.length === 0) {
    return command;
  }

  return `cd ${quote([workingDirectory])} && ${command}`;
}

function buildMissingLockfileMessage(
  repositoryName: string,
  manifestName: string,
  lockfileName: string,
  detail: string,
): string {
  return [
    `Auto bootstrap for ${repositoryName} found ${manifestName} but no ${lockfileName}.`,
    detail,
    "Add the lockfile or switch spec.repositories[].bootstrap.strategy to manual.",
  ].join(" ");
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
