import type { ReportStatus } from "../../report/types.js";
import { escalateStatus } from "../errors.js";

interface ReportWithIssues<TIssue> {
  status: ReportStatus;
  issues: TIssue[];
}

export function appendReportIssue<TIssue>(
  report: ReportWithIssues<TIssue>,
  issue: TIssue,
  status: ReportStatus = "warning",
): void {
  report.status = escalateStatus(report.status, status);
  report.issues.push(issue);
}

export function appendReportIssues<TIssue>(
  report: ReportWithIssues<TIssue>,
  issues: TIssue[],
  status: ReportStatus = "warning",
): void {
  if (issues.length === 0) {
    return;
  }

  report.status = escalateStatus(report.status, status);
  report.issues.push(...issues);
}

export function appendReportError<TIssue>(report: ReportWithIssues<TIssue>, issue: TIssue): void {
  report.status = "error";
  report.issues.push(issue);
}
