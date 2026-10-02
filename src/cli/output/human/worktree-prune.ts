import type { WorktreePruneReport } from "../../../report/types.js";
import {
  makeTable,
  paintStatus,
  renderHookRuns,
  renderIssues,
  summaryLine,
  type HumanFormatContext,
} from "./shared.js";

export function formatWorktreePruneReport(
  report: WorktreePruneReport,
  ctx: HumanFormatContext,
): string {
  const verb = report.dryRun ? "would remove" : "removed";
  const summary = summaryLine(
    report.dryRun ? "worktree prune (dry run)" : "worktree prune",
    report.status,
    `${report.removed.length} ${verb}, ${report.deletedBranches.length} branches, ${report.kept.length} kept`,
    ctx,
  );

  if (report.removed.length + report.deletedBranches.length + report.kept.length === 0) {
    return `${summary}\n${report.workspace}\nok - nothing to do${renderHookRuns(report.hooks, ctx)}${renderIssues(report.issues, ctx)}\n`;
  }

  const table = makeTable(["Item", "Action", "Detail"], [36, 16, 56]);
  for (const name of report.removed) {
    table.push([name, paintStatus(report.dryRun ? "remove" : "removed", "ok", ctx), "task"]);
  }
  for (const { name, branch } of report.deletedBranches) {
    table.push([
      branch,
      paintStatus(report.dryRun ? "delete" : "deleted", "ok", ctx),
      `branch in ${name}`,
    ]);
  }
  for (const { name, reasons } of report.kept) {
    table.push([name, paintStatus("kept", "warning", ctx), reasons.join("; ")]);
  }

  return `${summary}\n${report.workspace}\n${table.toString()}${renderHookRuns(report.hooks, ctx)}${renderIssues(report.issues, ctx)}\n`;
}
