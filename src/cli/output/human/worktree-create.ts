import Table from "cli-table3";
import type { TaskWorktreeReport } from "../../../report/types.js";
import { paintStatus, renderIssues, summaryLine, type HumanFormatContext } from "./shared.js";

function toneForStatus(status: "created" | "updated" | "unchanged"): "ok" | "neutral" | "dim" {
  if (status === "created") return "ok";
  if (status === "updated") return "neutral";
  return "dim";
}

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

  const table = new Table({
    head: ["Repository", "Status", "Branch", "Path"],
    style: { head: [], border: [] },
    colWidths: [20, 12, 28, 48],
    wordWrap: true,
  });
  for (const repo of report.repositories) {
    table.push([
      repo.name,
      paintStatus(repo.status, toneForStatus(repo.status), ctx),
      repo.branch,
      repo.path,
    ]);
  }

  return `${summary}\n${report.root}\n${table.toString()}${renderIssues(report.issues, ctx)}\n`;
}
