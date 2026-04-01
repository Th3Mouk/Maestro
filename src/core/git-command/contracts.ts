import type { WorkspaceGitReport } from "../../report/types.js";

export type WorkspaceGitCommand = WorkspaceGitReport["command"];

export interface RepositoryCommandResult {
  repository: WorkspaceGitReport["repositories"][number];
  issue?: WorkspaceGitReport["issues"][number];
}
