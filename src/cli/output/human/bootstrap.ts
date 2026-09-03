import type { BootstrapReport } from "../../../report/types.js";
import {
  dim,
  makeTable,
  paintStatus,
  renderIssues,
  summaryLine,
  type HumanFormatContext,
} from "./shared.js";

type RepositoryState = BootstrapReport["repositories"][number]["state"];

function toneForState(state: RepositoryState): "ok" | "error" | "dim" {
  switch (state) {
    case "executed":
      return "ok";
    case "failed":
      return "error";
    case "skipped":
      return "dim";
  }
}

export function formatBootstrapReport(report: BootstrapReport, ctx: HumanFormatContext): string {
  const executed = report.repositories.filter((entry) => entry.state === "executed").length;
  const failed = report.repositories.filter((entry) => entry.state === "failed").length;
  const skipped = report.repositories.length - executed - failed;
  const summary = summaryLine(
    "repo bootstrap",
    report.status,
    `${executed} executed, ${skipped} skipped, ${failed} failed, ${report.issues.length} issues`,
    ctx,
  );

  if (report.repositories.length === 0) {
    return `${summary}\n${report.workspace}\nok - nothing to do${renderIssues(report.issues, ctx)}\n`;
  }

  const table = makeTable(["Repository", "State", "Commands"], [24, 12, 64]);
  for (const repo of report.repositories) {
    const state = paintStatus(repo.state, toneForState(repo.state), ctx);
    const commandsCell = repo.commands.length > 0 ? repo.commands.join("\n") : dim("(none)", ctx);
    table.push([repo.name, state, commandsCell]);
  }

  return `${summary}\n${report.workspace}\n${table.toString()}${renderIssues(report.issues, ctx)}\n`;
}
