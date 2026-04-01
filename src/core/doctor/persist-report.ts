import path from "node:path";
import type { DoctorReport } from "../../report/types.js";
import { resolveSafePath, withWorkspaceLock, writeJson } from "../../utils/fs.js";
import { workspaceStateDirName } from "../../workspace/state-directory.js";

export async function persistDoctorReport(
  workspaceRoot: string,
  report: DoctorReport,
): Promise<void> {
  await withWorkspaceLock(workspaceRoot, async () => {
    const reportPath = resolveSafePath(
      workspaceRoot,
      path.join(workspaceStateDirName, "reports", "doctor-report.json"),
      "doctor report path",
    );
    await writeJson(reportPath, report);
  });
}
