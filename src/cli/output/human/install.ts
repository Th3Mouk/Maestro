import Table from "cli-table3";
import type { InstallReport } from "../../../report/types.js";
import { paintStatus, renderIssues, summaryLine, type HumanFormatContext } from "./shared.js";

function toneForRepoStatus(status: "created" | "updated" | "unchanged"): "ok" | "neutral" | "dim" {
  if (status === "created") return "ok";
  if (status === "updated") return "neutral";
  return "dim";
}

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

  const table = new Table({
    head: ["Repository", "Status", "Path"],
    style: { head: [], border: [] },
    colWidths: [24, 12, 64],
    wordWrap: true,
  });
  for (const repo of report.repositories) {
    table.push([
      repo.name,
      paintStatus(repo.status, toneForRepoStatus(repo.status), ctx),
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
