import type { TaskCheckoutState, WorktreeListReport } from "../../../report/types.js";
import {
  dim,
  makeTable,
  paintStatus,
  renderIssues,
  summaryLine,
  type HumanFormatContext,
} from "./shared.js";
import { buildTaskRows } from "../../../core/execution-support/task-worktree-rows.js";

export function formatWorktreeListReport(
  report: WorktreeListReport,
  ctx: HumanFormatContext,
  options: { detail?: boolean } = {},
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

  if (report.root || report.worktrees.some((worktree) => worktree.checkouts)) {
    const table = options.detail ? formatCheckoutTable(report, ctx) : formatTaskTable(report, ctx);
    return `${summary}\n${report.workspace}\n${table}${renderForeign(report, ctx)}${renderIssues(report.issues, ctx)}\n`;
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

/** `list --status`: one row per task, the main workspace first. */
function formatTaskTable(report: WorktreeListReport, ctx: HumanFormatContext): string {
  const rows = buildTaskRows(report, {
    // The primary clones the main workspace holds: a task holding all of them shows `all`.
    allRepositories: (report.root?.checkouts ?? []).slice(1).map((checkout) => checkout.name),
  });
  const extraNames = [...new Set(rows.flatMap((row) => Object.keys(row.extra)))];
  const table = makeTable(
    ["Task", "Repos", "Uncommitted", "Unlanded", "Prunable", "Age", ...extraNames],
    [24, 20, 22, 22, 10, 6, ...extraNames.map(() => 12)],
  );
  // A space after each comma lets long checkout lists wrap instead of being cut off.
  const wrap = (value: string) => value.replaceAll(",", ", ");
  for (const row of rows) {
    table.push([
      row.name,
      wrap(row.repos),
      row.uncommitted === "-" ? dim("-", ctx) : paintStatus(wrap(row.uncommitted), "warning", ctx),
      row.unlanded === "-" ? dim("-", ctx) : paintStatus(wrap(row.unlanded), "warning", ctx),
      row.prunable === "yes" ? paintStatus("yes", "ok", ctx) : dim(row.prunable, ctx),
      row.age,
      ...extraNames.map((name) => row.extra[name] ?? "-"),
    ]);
  }
  return table.toString();
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
