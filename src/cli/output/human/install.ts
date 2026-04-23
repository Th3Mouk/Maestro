import type { InstallReport } from "../../../report/types.js";
import {
  makeTable,
  paintStatus,
  renderIssues,
  summaryLine,
  toneForMutationStatus,
  type HumanFormatContext,
} from "./shared.js";

export function formatInstallReport(report: InstallReport, ctx: HumanFormatContext): string {
  const summary = summaryLine(
    "workspace install",
    report.status,
    `${report.repositories.length} repositories, ${report.issues.length} issues`,
    ctx,
  );

  if (report.repositories.length === 0) {
    const actionLine = report.actions.length > 0 ? `\nActions: ${report.actions.join(", ")}` : "";
    return `${summary}\n${report.workspace}\n(no repositories)${actionLine}${renderIssues(report.issues, ctx)}\n`;
  }

  const table = makeTable(["Repository", "Status", "Path"], [24, 12, 64]);
  for (const repo of report.repositories) {
    table.push([
      repo.name,
      paintStatus(repo.status, toneForMutationStatus(repo.status), ctx),
      repo.path,
    ]);
  }

  const actionLine = report.actions.length > 0 ? `\nActions: ${report.actions.join(", ")}` : "";
  const runtimes =
    report.projectedRuntimes.length > 0
      ? `\nProjected runtimes: ${report.projectedRuntimes.join(", ")}`
      : "";

  return `${summary}\n${report.workspace}${actionLine}${runtimes}\n${table.toString()}${renderIssues(report.issues, ctx)}\n`;
}
