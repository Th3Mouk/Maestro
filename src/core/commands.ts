import type { DoctorReport, InstallReport, WorkspaceGitReport } from "../report/types.js";
import type { CommandContext } from "./command-context.js";
import { createCommandContext } from "./command-context.js";
import { bootstrapWorkspace, createTaskWorktree } from "./commands/execution.js";
import {
  checkoutWorkspaceGitBranches as checkoutWorkspaceGitBranchesCommand,
  pullWorkspaceGitBranches as pullWorkspaceGitBranchesCommand,
  syncWorkspaceGitBranches as syncWorkspaceGitBranchesCommand,
} from "./commands/workspace-git.js";
import { initWorkspace } from "./commands/workspace-init.js";
import { doctorWorkspace as doctorWorkspaceCommand } from "./commands/workspace-doctor.js";
import {
  installWorkspace as installWorkspaceCommand,
  syncWorkspace as syncWorkspaceCommand,
  updateWorkspace as updateWorkspaceCommand,
} from "./commands/workspace-install.js";

/**
 * Compatibility façade for programmatic consumers importing from `src/core/commands.ts`.
 * The CLI executes command modules directly from `src/core/commands/*`.
 * Keep this layer until a dedicated breaking-change window defines migration steps.
 */
export { bootstrapWorkspace, createTaskWorktree, initWorkspace };
export { projectEditorWorkspace } from "./execution-service.js";

export async function installWorkspace(
  workspaceRoot: string,
  options: { dryRun?: boolean; reportName?: string } = {},
  context: CommandContext = createCommandContext(),
): Promise<InstallReport> {
  return installWorkspaceCommand(workspaceRoot, options, context);
}

export async function syncWorkspace(
  workspaceRoot: string,
  options: { dryRun?: boolean } = {},
  context: CommandContext = createCommandContext(),
): Promise<InstallReport> {
  return syncWorkspaceCommand(workspaceRoot, options, context);
}

export async function updateWorkspace(
  workspaceRoot: string,
  options: { dryRun?: boolean } = {},
  context: CommandContext = createCommandContext(),
): Promise<InstallReport> {
  return updateWorkspaceCommand(workspaceRoot, options, context);
}

export async function doctorWorkspace(
  workspaceRoot: string,
  context: CommandContext = createCommandContext(),
): Promise<DoctorReport> {
  return doctorWorkspaceCommand(workspaceRoot, context);
}

export async function checkoutWorkspaceGitBranches(
  workspaceRoot: string,
  context: CommandContext = createCommandContext(),
): Promise<WorkspaceGitReport> {
  return checkoutWorkspaceGitBranchesCommand(workspaceRoot, context);
}

export async function pullWorkspaceGitBranches(
  workspaceRoot: string,
  context: CommandContext = createCommandContext(),
): Promise<WorkspaceGitReport> {
  return pullWorkspaceGitBranchesCommand(workspaceRoot, context);
}

export async function syncWorkspaceGitBranches(
  workspaceRoot: string,
  context: CommandContext = createCommandContext(),
): Promise<WorkspaceGitReport> {
  return syncWorkspaceGitBranchesCommand(workspaceRoot, context);
}
