import type { DoctorReport } from "../../report/types.js";
import { errorMessage, MaestroError } from "../errors.js";
import { appendReportError, appendReportIssue, appendReportIssues } from "../reporting/issues.js";

type DoctorIssue = DoctorReport["issues"][number];

export function createDoctorReport(workspaceName: string): DoctorReport {
  return {
    status: "ok",
    workspace: workspaceName,
    issues: [],
  };
}

export function pushDoctorWarning(report: DoctorReport, issue: DoctorIssue): void {
  appendReportIssue(report, issue, "warning");
}

export function pushDoctorWarnings(report: DoctorReport, issues: DoctorIssue[]): void {
  appendReportIssues(report, issues, "warning");
}

function pushDoctorError(report: DoctorReport, issue: DoctorIssue): void {
  appendReportError(report, issue);
}

export function pushDoctorFailure(
  report: DoctorReport,
  code: DoctorIssue["code"],
  message: string,
  error: unknown,
  path?: string,
): void {
  pushDoctorError(report, {
    code,
    message: errorMessage(
      new MaestroError({
        code,
        message,
        path,
        cause: error,
      }),
    ),
    path,
  });
}
