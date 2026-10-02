import type { WorktreeOpenReport } from "../../../report/types.js";
import { formatWorktreeCreateReport } from "./worktree-create.js";
import { renderIssues, summaryLine, type HumanFormatContext } from "./shared.js";

/** `worktree open` and `worktree path` reports, on stderr: stdout carries the root itself. */
export function formatWorktreeOpenReport(
  report: WorktreeOpenReport,
  ctx: HumanFormatContext,
  command: "open" | "path" = "open",
): string {
  const opened = report.launch ? `${report.editor}: ${report.launch}` : report.editor;
  const summary = summaryLine(
    `worktree ${command}${report.name ? ` ${report.name}` : ""}`,
    report.status,
    opened ?? "",
    ctx,
  );
  const created = report.created ? formatWorktreeCreateReport(report.created, ctx) : "";
  return `${created}${summary}${renderIssues(report.issues, ctx)}\n`;
}
