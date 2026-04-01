import path from "node:path";
import type { DoctorReport } from "../../report/types.js";
import { pathExists, readText, resolveSafePath } from "../../utils/fs.js";
import { workspaceLockfileSchema, workspaceStateSchema } from "../../workspace/schema.js";
import { workspaceStateDirName } from "../../workspace/state-directory.js";
import { errorMessage, MaestroError } from "../errors.js";
import { pushDoctorWarning } from "./reporting.js";

interface JsonValidationOptions {
  code: "LOCKFILE_INVALID" | "STATE_INVALID";
  errorPath: string;
  message: string;
}

async function validateJsonFile(
  report: DoctorReport,
  filePath: string,
  options: JsonValidationOptions,
): Promise<void> {
  try {
    const content = JSON.parse(await readText(filePath));
    if (options.code === "LOCKFILE_INVALID") {
      workspaceLockfileSchema.parse(content);
      return;
    }
    workspaceStateSchema.parse(content);
  } catch (error) {
    pushDoctorWarning(report, {
      code: options.code,
      message: errorMessage(
        new MaestroError({
          code: options.code,
          message: options.message,
          path: options.errorPath,
          cause: error,
        }),
      ),
      path: options.errorPath,
    });
  }
}

export async function runLockAndStateChecks(
  workspaceRoot: string,
  report: DoctorReport,
): Promise<void> {
  const lockfilePath = resolveSafePath(
    workspaceRoot,
    path.join(workspaceStateDirName, "lock.json"),
    "workspace lockfile",
  );
  if (!(await pathExists(lockfilePath))) {
    pushDoctorWarning(report, {
      code: "LOCKFILE_MISSING",
      message: "Lockfile is missing.",
    });
  } else {
    await validateJsonFile(report, lockfilePath, {
      code: "LOCKFILE_INVALID",
      errorPath: lockfilePath,
      message: "Lockfile content is invalid.",
    });
  }

  const statePath = resolveSafePath(
    workspaceRoot,
    path.join(workspaceStateDirName, "state.json"),
    "workspace state",
  );
  if (await pathExists(statePath)) {
    await validateJsonFile(report, statePath, {
      code: "STATE_INVALID",
      errorPath: statePath,
      message: "Workspace state content is invalid.",
    });
  }
}
