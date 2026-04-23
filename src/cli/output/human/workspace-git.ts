import type { WorkspaceGitReport } from "../../../report/types.js";
import {
  makeTable,
  paintStatus,
  renderIssues,
  summaryLine,
  type HumanFormatContext,
} from "./shared.js";

type GitStatus = WorkspaceGitReport["repositories"][number]["status"];

function toneForStatus(status: GitStatus): "ok" | "error" | "dim" {
  if (status === "updated") return "ok";
  if (status === "failed") return "error";
  return "dim";
}

export function formatWorkspaceGitReport(
  report: WorkspaceGitReport,
  ctx: HumanFormatContext,
): string {
  const updated = report.repositories.filter((r) => r.status === "updated").length;
  const failed = report.repositories.filter((r) => r.status === "failed").length;
  const summary = summaryLine(
    `repo git ${report.command}`,
    report.status,
    `${updated} updated, ${failed} failed, ${report.repositories.length} total`,
    ctx,
  );

  if (report.repositories.length === 0) {
    return `${summary}\n${report.workspace}\nok - nothing to do${renderIssues(report.issues, ctx)}\n`;
  }

  const table = makeTable(
    ["Repository", "Branch", "Status", "Path", "Detail"],
    [20, 24, 12, 40, 28],
  );
  for (const repo of report.repositories) {
    table.push([
      repo.name,
      repo.branch,
      paintStatus(repo.status, toneForStatus(repo.status), ctx),
      repo.path,
      repo.message ?? "",
    ]);
  }

  return `${summary}\n${report.workspace}\n${table.toString()}${renderIssues(report.issues, ctx)}\n`;
}
