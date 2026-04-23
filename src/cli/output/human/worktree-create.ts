import type { TaskWorktreeReport } from "../../../report/types.js";
import {
  makeTable,
  paintStatus,
  renderIssues,
  summaryLine,
  toneForMutationStatus,
  type HumanFormatContext,
} from "./shared.js";

export function formatWorktreeCreateReport(
  report: TaskWorktreeReport,
  ctx: HumanFormatContext,
): string {
  const summary = summaryLine(
    `worktree create ${report.name}`,
    report.status,
    `${report.repositories.length} repositories, ${report.issues.length} issues`,
    ctx,
  );

  if (report.repositories.length === 0) {
    return `${summary}\n${report.root}\nok - nothing to do${renderIssues(report.issues, ctx)}\n`;
  }

  const table = makeTable(["Repository", "Status", "Branch", "Path"], [20, 12, 28, 48]);
  for (const repo of report.repositories) {
    table.push([
      repo.name,
      paintStatus(repo.status, toneForMutationStatus(repo.status), ctx),
      repo.branch,
      repo.path,
    ]);
  }

  return `${summary}\n${report.root}\n${table.toString()}${renderIssues(report.issues, ctx)}\n`;
}
