import Table from "cli-table3";
import type { WorktreeListReport } from "../../../report/types.js";
import { renderIssues, summaryLine, type HumanFormatContext } from "./shared.js";

export function formatWorktreeListReport(
  report: WorktreeListReport,
  ctx: HumanFormatContext,
): string {
  const summary = summaryLine(
    "worktree list",
    report.status,
    `${report.worktrees.length} worktrees`,
    ctx,
  );

  if (report.worktrees.length === 0) {
    return `${summary}\n${report.workspace}\nok - nothing to do${renderIssues(report.issues, ctx)}\n`;
  }

  const table = new Table({
    head: ["Name", "Root", "Created"],
    style: { head: [], border: [] },
    colWidths: [28, 56, 26],
    wordWrap: true,
  });
  for (const worktree of report.worktrees) {
    table.push([worktree.name, worktree.root, worktree.createdAt]);
  }

  return `${summary}\n${report.workspace}\n${table.toString()}${renderIssues(report.issues, ctx)}\n`;
}
