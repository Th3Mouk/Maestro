import type { DoctorReport } from "../../../report/types.js";
import { bold, dim, paintStatus, summaryLine, type HumanFormatContext } from "./shared.js";

type IssueSeverity = "error" | "warning" | "info";

function classifySeverity(code: string): IssueSeverity {
  const upper = code.toUpperCase();
  if (upper.includes("ERROR") || upper.includes("MISSING") || upper.includes("INVALID")) {
    return "error";
  }
  if (upper.includes("WARN")) {
    return "warning";
  }
  return "info";
}

export function formatDoctorReport(report: DoctorReport, ctx: HumanFormatContext): string {
  const summary = summaryLine(
    "workspace doctor",
    report.status,
    `${report.issues.length} issues`,
    ctx,
  );

  if (report.issues.length === 0) {
    return `${summary}\n${report.workspace}\nok - nothing to report\n`;
  }

  const grouped: Record<IssueSeverity, DoctorReport["issues"]> = {
    error: [],
    warning: [],
    info: [],
  };
  for (const issue of report.issues) {
    grouped[classifySeverity(issue.code)].push(issue);
  }

  const sections: string[] = [];
  const order: IssueSeverity[] = ["error", "warning", "info"];
  for (const severity of order) {
    const bucket = grouped[severity];
    if (bucket.length === 0) continue;
    const tone = severity === "error" ? "error" : severity === "warning" ? "warning" : "neutral";
    const header = paintStatus(severity.toUpperCase(), tone, ctx);
    const lines = bucket.map((issue) => {
      const suffix = issue.path ? ` ${dim(`(${issue.path})`, ctx)}` : "";
      return `  - ${bold(issue.code, ctx)}: ${issue.message}${suffix}`;
    });
    sections.push(`${header}\n${lines.join("\n")}`);
  }

  return `${summary}\n${report.workspace}\n${sections.join("\n\n")}\n`;
}
