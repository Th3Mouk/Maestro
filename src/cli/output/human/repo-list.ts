import type { RepoListReport } from "../../../report/types.js";
import {
  makeTable,
  paintStatus,
  renderIssues,
  summaryLine,
  type HumanFormatContext,
} from "./shared.js";

export function formatRepoListReport(report: RepoListReport, ctx: HumanFormatContext): string {
  const installed = report.repositories.filter((entry) => entry.installed).length;
  const summary = summaryLine(
    "repo list",
    report.status,
    `${report.repositories.length} repositories, ${installed} installed`,
    ctx,
  );

  if (report.repositories.length === 0) {
    return `${summary}\n${report.workspace}\n(no repositories)${renderIssues(report.issues, ctx)}\n`;
  }

  const table = makeTable(
    ["Repository", "Branch", "Remote", "Installed", "Path"],
    [20, 20, 32, 11, 44],
  );
  for (const repo of report.repositories) {
    table.push([
      repo.name,
      repo.branch,
      repo.remote,
      repo.installed ? paintStatus("yes", "ok", ctx) : paintStatus("no", "dim", ctx),
      repo.path,
    ]);
  }

  return `${summary}\n${report.workspace}\n${table.toString()}${renderIssues(report.issues, ctx)}\n`;
}
