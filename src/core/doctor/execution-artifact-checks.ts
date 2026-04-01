import path from "node:path";
import type { DoctorReport } from "../../report/types.js";
import { pathExists, readText, resolveSafePath } from "../../utils/fs.js";
import { workspaceDescriptorSchema } from "../../workspace/schema.js";
import { workspaceStateDirName } from "../../workspace/state-directory.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import { errorMessage, MaestroError } from "../errors.js";
import { workspaceDescriptorFileName } from "../workspace-descriptor.js";
import { runPackHooks } from "../commands/pack-hooks.js";
import { pushDoctorWarning, pushDoctorWarnings } from "./reporting.js";

export async function runExecutionArtifactChecks(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  report: DoctorReport,
): Promise<void> {
  const bootstrapPlanPath = resolveSafePath(
    workspaceRoot,
    path.join(workspaceStateDirName, "execution", "bootstrap-plan.json"),
    "bootstrap plan path",
  );
  if (!(await pathExists(bootstrapPlanPath))) {
    pushDoctorWarning(report, {
      code: "EXECUTION_BOOTSTRAP_MISSING",
      message: "Bootstrap plan is missing.",
      path: bootstrapPlanPath,
    });
  }

  const workspaceDescriptorPath = resolveSafePath(
    workspaceRoot,
    workspaceDescriptorFileName,
    "workspace descriptor file",
  );
  if (!(await pathExists(workspaceDescriptorPath))) {
    pushDoctorWarning(report, {
      code: "WORKSPACE_DESCRIPTOR_MISSING",
      message: "Workspace descriptor file is missing.",
      path: workspaceDescriptorPath,
    });
  } else {
    try {
      workspaceDescriptorSchema.parse(JSON.parse(await readText(workspaceDescriptorPath)));
    } catch (error) {
      pushDoctorWarning(report, {
        code: "WORKSPACE_DESCRIPTOR_INVALID",
        message: errorMessage(
          new MaestroError({
            code: "WORKSPACE_DESCRIPTOR_INVALID",
            message: "Workspace descriptor content is invalid.",
            path: workspaceDescriptorPath,
            cause: error,
          }),
        ),
        path: workspaceDescriptorPath,
      });
    }
  }

  if (resolvedWorkspace.execution.worktrees?.enabled) {
    const worktreeConfigPath = resolveSafePath(
      workspaceRoot,
      path.join(workspaceStateDirName, "execution", "worktrees.json"),
      "worktree config path",
    );
    if (!(await pathExists(worktreeConfigPath))) {
      pushDoctorWarning(report, {
        code: "WORKTREE_CONFIG_MISSING",
        message: "Worktree configuration is missing.",
        path: worktreeConfigPath,
      });
    }
  }

  if (resolvedWorkspace.execution.devcontainer?.enabled) {
    for (const requiredPath of [
      resolveSafePath(
        workspaceRoot,
        path.join(".devcontainer", "devcontainer.json"),
        "devcontainer config",
      ),
      resolveSafePath(
        workspaceRoot,
        path.join(".devcontainer", "Dockerfile"),
        "devcontainer dockerfile",
      ),
      resolveSafePath(
        workspaceRoot,
        path.join(".devcontainer", "bootstrap.sh"),
        "devcontainer bootstrap",
      ),
    ]) {
      if (!(await pathExists(requiredPath))) {
        pushDoctorWarning(report, {
          code: "DEVCONTAINER_ARTIFACT_MISSING",
          message: "DevContainer artifact is missing.",
          path: requiredPath,
        });
      }
    }
  }

  const hookIssues = await runPackHooks(resolvedWorkspace, "validate", false, true);
  pushDoctorWarnings(report, hookIssues);
}
