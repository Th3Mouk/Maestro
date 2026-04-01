import path from "node:path";
import type { DoctorReport } from "../../report/types.js";
import { runDoctorDiagnostics } from "../doctor/diagnostics.js";
import { persistDoctorReport } from "../doctor/persist-report.js";
import { createDoctorReport, pushDoctorFailure } from "../doctor/reporting.js";
import type { CommandContext } from "../command-context.js";

export async function doctorWorkspace(
  workspaceRoot: string,
  context: CommandContext,
): Promise<DoctorReport> {
  const report = createDoctorReport(path.basename(workspaceRoot));

  try {
    await runDoctorDiagnostics(workspaceRoot, context, report);
  } catch (error) {
    pushDoctorFailure(report, "DOCTOR_FAILED", "Doctor command failed.", error);
  }

  await persistDoctorReport(workspaceRoot, report);
  return report;
}
