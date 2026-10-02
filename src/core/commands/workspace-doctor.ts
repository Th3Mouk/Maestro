import path from "node:path";
import type { DoctorReport } from "../../report/types.js";
import { runDoctorDiagnostics, type DoctorOptions } from "../doctor/diagnostics.js";
import { persistDoctorReport } from "../doctor/persist-report.js";
import { createDoctorReport, pushDoctorFailure } from "../doctor/reporting.js";
import type { CommandContext } from "../command-context.js";

export async function doctorWorkspace(
  workspaceRoot: string,
  context: CommandContext,
  options: DoctorOptions = {},
): Promise<DoctorReport> {
  const report = createDoctorReport(path.basename(workspaceRoot));

  try {
    await runDoctorDiagnostics(workspaceRoot, context, report, options);
  } catch (error) {
    pushDoctorFailure(report, "DOCTOR_FAILED", "Doctor command failed.", error);
  }

  await persistDoctorReport(workspaceRoot, report);
  return report;
}
