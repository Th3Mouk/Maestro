import Table from "cli-table3";
import type { WorktreeRemoveReport } from "../../../report/types.js";
import { paintStatus, renderIssues, summaryLine, type HumanFormatContext } from "./shared.js";

type RemoveStatus = WorktreeRemoveReport["repositories"][number]["status"];

function toneForStatus(status: RemoveStatus): "ok" | "error" | "dim" | "neutral" {
  switch (status) {
    case "removed":
      return "ok";
    case "failed":
      return "error";
    case "missing":
    case "skipped":
      return "dim";
    default:
      return "neutral";
  }
}

export function formatWorktreeRemoveReport(
  report: WorktreeRemoveReport,
  ctx: HumanFormatContext,
): string {
  const removed = report.repositories.filter((entry) => entry.status === "removed").length;
  const failed = report.repositories.filter((entry) => entry.status === "failed").length;
  const summary = summaryLine(
    `worktree remove ${report.name}`,
    report.status,
    `${removed} removed, ${failed} failed, root ${report.workspaceRootStatus}`,
    ctx,
  );

  if (report.repositories.length === 0) {
    return `${summary}\n${report.root}\nok - nothing to do${renderIssues(report.issues, ctx)}\n`;
  }

  const table = new Table({
    head: ["Repository", "Status", "Path", "Detail"],
    style: { head: [], border: [] },
    colWidths: [20, 10, 48, 32],
    wordWrap: true,
  });
  for (const repo of report.repositories) {
    table.push([
      repo.name,
      paintStatus(repo.status, toneForStatus(repo.status), ctx),
      repo.path,
      repo.message ?? "",
    ]);
  }

  return `${summary}\n${report.root}\n${table.toString()}${renderIssues(report.issues, ctx)}\n`;
}
