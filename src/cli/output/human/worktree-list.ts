import type { WorktreeListReport } from "../../../report/types.js";
import { makeTable, renderIssues, summaryLine, type HumanFormatContext } from "./shared.js";

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

  const table = makeTable(["Name", "Root", "Created"], [28, 56, 26]);
  for (const worktree of report.worktrees) {
    table.push([worktree.name, worktree.root, worktree.createdAt]);
  }

  return `${summary}\n${report.workspace}\n${table.toString()}${renderIssues(report.issues, ctx)}\n`;
}
