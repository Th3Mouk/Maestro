import type { WorkspaceGitReport } from "../../report/types.js";
import type { CommandContext } from "../command-context.js";
import { runWorkspaceGitCommand } from "../git-command/command-runner.js";

export async function checkoutWorkspaceGitBranches(
  workspaceRoot: string,
  context: CommandContext,
): Promise<WorkspaceGitReport> {
  return runWorkspaceGitCommand(workspaceRoot, "checkout", context);
}

export async function pullWorkspaceGitBranches(
  workspaceRoot: string,
  context: CommandContext,
): Promise<WorkspaceGitReport> {
  return runWorkspaceGitCommand(workspaceRoot, "pull", context);
}

export async function syncWorkspaceGitBranches(
  workspaceRoot: string,
  context: CommandContext,
): Promise<WorkspaceGitReport> {
  return runWorkspaceGitCommand(workspaceRoot, "sync", context);
}
