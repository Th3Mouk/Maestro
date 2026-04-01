import type { InstallReport } from "../../report/types.js";
import { getWorkspaceStateRoot } from "../../workspace/state-directory.js";
import { ensureDir } from "../../utils/fs.js";
import {
  finalizeWorkspaceInstall,
  initializeWorkspaceInstall,
} from "../install/workspace-install-lifecycle.js";
import { materializeWorkspaceRepositories } from "../install/repository-materializer.js";
import { removeStaleWorkspaceRepositories } from "../install/repository-sync.js";
import { projectWorkspaceRuntimes } from "../install/runtime-projection.js";
import { projectWorkspaceSkills } from "../install/skills-projection.js";
import { applyWorkspaceTemplates } from "../install/template-application.js";
import {
  createInstallReport,
  withActions,
  withRepositoryActions,
} from "../install/workspace-install-report.js";
import { resolveWorkspace } from "../workspace-service.js";
import { projectExecutionSupport } from "../execution-service.js";
import type { CommandContext } from "../command-context.js";
import { createLoopProgressReporter } from "./execution.js";
import { runPackHooks } from "./pack-hooks.js";

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
  let report = createInstallReport(resolvedWorkspace.manifest.metadata.name);
  const dryRun = Boolean(options.dryRun);

  await initializeWorkspaceInstall(workspaceRoot, resolvedWorkspace, dryRun, context.gitAdapter);

  const repositoryInstallResults = await materializeWorkspaceRepositories(
    workspaceRoot,
    resolvedWorkspace,
    dryRun,
    context.gitAdapter,
    repositoryProgress,
  );

  report = withRepositoryActions(report, repositoryInstallResults);
  repositoryProgress.complete();

  repositoryProgress.phase("projecting execution support");
  report = withActions(
    report,
    await projectExecutionSupport(workspaceRoot, resolvedWorkspace, options.dryRun),
  );
  if (!options.dryRun) {
    await ensureDir(getWorkspaceStateRoot(workspaceRoot, "reports"));
  }
  repositoryProgress.phase("projecting skills");
  await projectWorkspaceSkills(workspaceRoot, resolvedWorkspace, dryRun);
  repositoryProgress.phase("projecting runtimes");
  await projectWorkspaceRuntimes(workspaceRoot, resolvedWorkspace, dryRun);
  repositoryProgress.phase("applying templates");
  await applyWorkspaceTemplates(workspaceRoot, resolvedWorkspace, dryRun);
  repositoryProgress.phase("running pack hooks");
  await runPackHooks(resolvedWorkspace, "install", options.dryRun);
  repositoryProgress.phase("finalizing report");

  await finalizeWorkspaceInstall(
    workspaceRoot,
    resolvedWorkspace,
    report,
    options.reportName ?? "install-report.json",
    dryRun,
    context.gitAdapter,
  );

  return report;
}

export async function syncWorkspace(
  workspaceRoot: string,
  options: { dryRun?: boolean } = {},
  context: CommandContext,
): Promise<InstallReport> {
  const resolvedWorkspace = await resolveWorkspace(workspaceRoot);
  await removeStaleWorkspaceRepositories(
    workspaceRoot,
    resolvedWorkspace,
    context.gitAdapter,
    Boolean(options.dryRun),
  );

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
