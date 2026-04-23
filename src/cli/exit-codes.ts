import type { ReportStatus } from "../report/types.js";

/**
 * Centralized mapping from report status to process exit code.
 * `error` exits 1; both `ok` and `warning` exit 0.
 */
export function statusToExitCode(status: ReportStatus): 0 | 1 {
  return status === "error" ? 1 : 0;
}
