import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createBuiltInProjectors } from "../../adapters/runtimes/index.js";
import type { InstallReport } from "../../report/types.js";
import type { RuntimeName } from "../../runtime/types.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import { getWorkspaceStateRoot } from "../../workspace/state-directory.js";
import {
  copyDir,
  ensureDir,
  listDirectories,
  mapWithConcurrency,
  pathExists,
  removeIfExists,
  resolveSafePath,
  withWorkspaceLock,
  writeJson,
  writeText,
} from "../../utils/fs.js";
import { ensureWorkspaceSkeleton, resolveWorkspace } from "../workspace-service.js";
import { projectExecutionSupport } from "../execution-service.js";
import type { CommandContext } from "../command-context.js";
import { ensureWorkspaceGitignore } from "../workspace-gitignore.js";
import { createLoopProgressReporter } from "./execution.js";
import { runPackHooks } from "./pack-hooks.js";

const INSTALL_REPOSITORY_CONCURRENCY_LIMIT = 4;
const SKILL_PROJECTION_CONCURRENCY_LIMIT = 4;
const RUNTIME_PROJECTION_CONCURRENCY_LIMIT = 3;

export async function installWorkspace(
  workspaceRoot: string,
  options: { dryRun?: boolean; reportName?: string } = {},
  context: CommandContext,
): Promise<InstallReport> {
  const resolvedWorkspace = await resolveWorkspace(workspaceRoot);
  const repositoryProgress = createLoopProgressReporter(
    context.stderr,
    "install repositories",
    resolvedWorkspace.repositories.length,
  );
  const report: InstallReport = {
    status: "ok",
    workspace: resolvedWorkspace.manifest.metadata.name,
    actions: [],
    repositories: [],
    projectedRuntimes: [],
    issues: [],
  };

  await context.gitAdapter.ensureWorkspaceRepository(workspaceRoot, options.dryRun);
  if (!options.dryRun) {
    await ensureWorkspaceSkeleton(workspaceRoot, resolvedWorkspace.manifest);
    await ensureWorkspaceGitignore(workspaceRoot);
    await withWorkspaceLock(workspaceRoot, async () => {
      await writeJson(
        getWorkspaceStateRoot(workspaceRoot, "lock.json"),
        resolvedWorkspace.lockfile,
      );
    });
  }

  const repositoryInstallResults = await mapWithConcurrency(
    resolvedWorkspace.repositories,
    INSTALL_REPOSITORY_CONCURRENCY_LIMIT,
    async (repository, index) => {
      repositoryProgress.itemStarted(repository.name, index);
      const repoRoot = resolveSafePath(
        workspaceRoot,
        path.join("repos", repository.name),
        "repository root",
      );
      const status = await context.gitAdapter.ensureRepository(
        repoRoot,
        repository,
        options.dryRun,
      );
      repositoryProgress.itemCompleted();
      return { name: repository.name, path: repoRoot, status };
    },
  );

  for (const result of repositoryInstallResults) {
    report.repositories.push(result);
    report.actions.push(`${result.status}:${result.name}`);
  }
  repositoryProgress.complete();

  repositoryProgress.phase("projecting execution support");
  report.actions.push(
    ...(await projectExecutionSupport(workspaceRoot, resolvedWorkspace, options.dryRun)),
  );
  if (!options.dryRun) {
    await ensureDir(getWorkspaceStateRoot(workspaceRoot, "reports"));
  }
  repositoryProgress.phase("projecting skills");
  await projectSkills(workspaceRoot, resolvedWorkspace, options.dryRun);
  repositoryProgress.phase("projecting runtimes");
  await projectRuntimes(workspaceRoot, resolvedWorkspace, options.dryRun);
  repositoryProgress.phase("applying templates");
  await applyTemplates(workspaceRoot, resolvedWorkspace, options.dryRun);
  repositoryProgress.phase("running pack hooks");
  await runPackHooks(resolvedWorkspace, "install", options.dryRun);
  repositoryProgress.phase("finalizing report");

  if (!options.dryRun) {
    await withWorkspaceLock(workspaceRoot, async () => {
      await writeJson(getWorkspaceStateRoot(workspaceRoot, "state.json"), {
        installedAt: new Date().toISOString(),
        workspace: resolvedWorkspace.manifest.metadata.name,
        runtimes: Object.keys(resolvedWorkspace.runtimes),
      });
    });
  }

  const reportsRoot = getWorkspaceStateRoot(workspaceRoot, "reports");
  const reportPath = resolveSafePath(
    reportsRoot,
    options.reportName ?? "install-report.json",
    "install report path",
  );
  if (!options.dryRun) {
    await withWorkspaceLock(workspaceRoot, async () => {
      await writeJson(reportPath, report);
    });
  }

  if (
    !options.dryRun &&
    (await pathExists(path.join(workspaceRoot, ".gitignore"))) &&
    (await context.gitAdapter.isUnbornRepository(workspaceRoot))
  ) {
    await context.gitAdapter.commitAll(workspaceRoot, "🪄 booted by Maestro");
  }

  return report;
}

export async function syncWorkspace(
  workspaceRoot: string,
  options: { dryRun?: boolean } = {},
  context: CommandContext,
): Promise<InstallReport> {
  const resolvedWorkspace = await resolveWorkspace(workspaceRoot);
  const desiredRepos = new Set(resolvedWorkspace.repositories.map((entry) => entry.name));
  const reposRoot = resolveSafePath(workspaceRoot, "repos", "repositories root");
  const existingRepos = await listDirectories(reposRoot);

  for (const repoName of existingRepos.filter((entry) => !desiredRepos.has(entry))) {
    const repoRoot = resolveSafePath(reposRoot, repoName, "repository root");
    if (!(await context.gitAdapter.isClean(repoRoot))) {
      throw new Error(`Cannot remove ${repoName}: working tree is not clean.`);
    }

    if (!options.dryRun) {
      await removeIfExists(repoRoot);
    }
  }

  return installWorkspace(
    workspaceRoot,
    {
      dryRun: options.dryRun,
      reportName: "sync-report.json",
    },
    context,
  );
}

export async function updateWorkspace(
  workspaceRoot: string,
  options: { dryRun?: boolean } = {},
  context: CommandContext,
): Promise<InstallReport> {
  return installWorkspace(
    workspaceRoot,
    {
      dryRun: options.dryRun,
      reportName: "update-report.json",
    },
    context,
  );
}

async function projectSkills(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  dryRun = false,
): Promise<void> {
  const skillsRoot = getWorkspaceStateRoot(workspaceRoot, "skills");
  if (!dryRun) {
    await withWorkspaceLock(workspaceRoot, async () => {
      await removeIfExists(skillsRoot);
      await ensureDir(skillsRoot);
    });
  }

  if (dryRun) {
    return;
  }

  await withWorkspaceLock(workspaceRoot, async () => {
    await mapWithConcurrency(
      resolvedWorkspace.selectedSkills,
      SKILL_PROJECTION_CONCURRENCY_LIMIT,
      async (skill) => {
        const projectedSkillRoot = resolveSafePath(skillsRoot, skill.name, "skill projection path");
        await copyDir(skill.root, projectedSkillRoot);
      },
    );
  });
}

async function projectRuntimes(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  dryRun = false,
): Promise<void> {
  const availableProjectors = createBuiltInProjectors();
  if (dryRun) {
    return;
  }

  const selectedProjectors = availableProjectors.filter((projector) =>
    Boolean(resolvedWorkspace.runtimes[projector.name as RuntimeName]),
  );

  await mapWithConcurrency(
    selectedProjectors,
    RUNTIME_PROJECTION_CONCURRENCY_LIMIT,
    async (projector) => {
      await projector.project({ workspaceRoot, resolvedWorkspace });
    },
  );
}

async function applyTemplates(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  dryRun = false,
): Promise<void> {
  const templateTargets = ["AGENTS.md", "CLAUDE.md"];
  for (const templateName of templateTargets) {
    const overridePath = resolveSafePath(
      workspaceRoot,
      path.join("overrides", "templates", templateName),
      "template override path",
    );
    if (await pathExists(overridePath)) {
      if (!dryRun) {
        await writeText(
          resolveSafePath(workspaceRoot, templateName, "template target path"),
          await readFile(overridePath, "utf8"),
        );
      }
      continue;
    }

    const packPath = resolvedWorkspace.packs
      .map((pack) => path.join(pack.root, "templates", templateName))
      .find((candidate) => existsSync(candidate));

    if (packPath && !dryRun) {
      await writeText(
        resolveSafePath(workspaceRoot, templateName, "template target path"),
        await readFile(packPath, "utf8"),
      );
    }
  }
}
