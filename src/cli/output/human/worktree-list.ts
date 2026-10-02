import type { TaskCheckoutState, WorktreeListReport } from "../../../report/types.js";
import {
  dim,
  makeTable,
  paintStatus,
  renderIssues,
  summaryLine,
  type HumanFormatContext,
} from "./shared.js";

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
    return `${summary}\n${report.workspace}\nok - nothing to do${renderForeign(report, ctx)}${renderIssues(report.issues, ctx)}\n`;
  }

  if (report.worktrees.some((worktree) => worktree.checkouts)) {
    return `${summary}\n${report.workspace}\n${formatCheckoutTable(report, ctx)}${renderForeign(report, ctx)}${renderIssues(report.issues, ctx)}\n`;
  }

  const table = makeTable(["Name", "Repositories", "Root", "Created"], [24, 24, 48, 26]);
  for (const worktree of report.worktrees) {
    table.push([
      worktree.name,
      worktree.repositories.join(", "),
      worktree.root,
      worktree.createdAt,
    ]);
  }

  return `${summary}\n${report.workspace}\n${table.toString()}${renderForeign(report, ctx)}${renderIssues(report.issues, ctx)}\n`;
}

function renderForeign(report: WorktreeListReport, ctx: HumanFormatContext): string {
  if (!report.foreign?.length) {
    return "";
  }
  const lines = report.foreign.map((entry) => {
    const source = entry.source ? ` of ${entry.source}` : "";
    return `  - ${entry.path} ${dim(`(${entry.kind}${source})`, ctx)}`;
  });
  return `\nNot task worktrees (left untouched):\n${lines.join("\n")}`;
}

function describeCheckout(checkout: TaskCheckoutState): string {
  if (checkout.error) {
    return `error: ${checkout.error}`;
  }
  const parts = [
    checkout.dirty ? "dirty" : "clean",
    `${checkout.localOnly} local-only`,
    `upstream ${checkout.upstream}`,
  ];
  if (checkout.integrated) {
    parts.push(
      checkout.integratedBy === "forge" && checkout.pr !== undefined
        ? `integrated (merged in #${checkout.pr})`
        : "integrated",
    );
  }
  return parts.join(", ");
}

function formatCheckoutTable(report: WorktreeListReport, ctx: HumanFormatContext): string {
  const table = makeTable(["Task", "Checkout", "Branch", "State"], [22, 20, 34, 40]);
  for (const worktree of report.worktrees) {
    const prunable = worktree.prunable
      ? paintStatus("prunable", "ok", ctx)
      : paintStatus("kept", "dim", ctx);
    for (const [index, checkout] of (worktree.checkouts ?? []).entries()) {
      table.push([
        index === 0 ? `${worktree.name}\n${prunable}` : "",
        checkout.name,
        checkout.branch ?? "(detached)",
        describeCheckout(checkout),
      ]);
    }
  }
  return table.toString();
}
