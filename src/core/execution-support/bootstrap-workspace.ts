import { execa } from "execa";
import type { BootstrapReport } from "../../report/types.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import { appendReportIssues } from "../reporting/issues.js";
import {
  createBootstrapRepositoryReport,
  executeBootstrapPlan,
  selectBootstrapPlanEntries,
} from "../execution/bootstrap-execution.js";
import { buildBootstrapPlan } from "../execution/bootstrap-plan.js";

export async function bootstrapWorkspaceWithResolvedWorkspace(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  options: { repository?: string; dryRun?: boolean },
  concurrencyLimit: number,
): Promise<BootstrapReport> {
  const bootstrapPlan = await buildBootstrapPlan(
    workspaceRoot,
    resolvedWorkspace,
    concurrencyLimit,
  );
  const selection = selectBootstrapPlanEntries(bootstrapPlan, options.repository);
  const report: BootstrapReport = {
    status: "ok",
    workspace: resolvedWorkspace.manifest.metadata.name,
    repositories: [],
    issues: [],
  };

  if (selection.issue) {
    report.status = "error";
    report.issues.push(selection.issue);
    return report;
  }

  report.repositories = createBootstrapRepositoryReport(selection.entries);
  appendReportIssues(
    report,
    selection.entries.flatMap((e) => e.issues),
  );

  const issues = await executeBootstrapPlan(selection.entries, {
    concurrencyLimit,
    dryRun: options.dryRun,
    runCommand: async (entry, command) => {
      await execa("bash", ["-lc", command], {
        cwd: entry.repoRoot,
        stdio: "inherit",
      });
    },
  });

  appendReportIssues(report, issues);

  return report;
}
