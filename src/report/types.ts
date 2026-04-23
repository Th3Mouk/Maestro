export type ReportStatus = "ok" | "warning" | "error";

export interface InstallReport {
  status: ReportStatus;
  workspace: string;
  actions: string[];
  repositories: Array<{
    name: string;
    status: "created" | "updated" | "unchanged";
    path: string;
  }>;
  projectedRuntimes: string[];
  issues: Array<{ code: string; message: string }>;
}

export interface BootstrapReport {
  status: ReportStatus;
  workspace: string;
  repositories: Array<{
    name: string;
    commands: string[];
    skipped: boolean;
  }>;
  issues: Array<{ code: string; message: string; path?: string }>;
}

export interface TaskWorktreeReport {
  status: ReportStatus;
  workspace: string;
  name: string;
  root: string;
  repositories: Array<{
    name: string;
    path: string;
    branch: string;
    status: "created" | "updated" | "unchanged";
  }>;
  issues: Array<{ code: string; message: string; path?: string }>;
}

export interface DoctorReport {
  status: ReportStatus;
  workspace: string;
  issues: Array<{ code: string; message: string; path?: string }>;
}

export interface WorktreeRemoveReport {
  status: ReportStatus;
  workspace: string;
  name: string;
  root: string;
  repositories: Array<{
    name: string;
    path: string;
    status: "removed" | "missing" | "skipped" | "failed";
    message?: string;
  }>;
  workspaceRootStatus: "removed" | "missing" | "skipped" | "failed";
  issues: Array<{ code: string; message: string; path?: string }>;
}

export interface WorktreeListReport {
  status: ReportStatus;
  workspace: string;
  worktrees: Array<{
    name: string;
    root: string;
    createdAt: string;
  }>;
  issues: Array<{ code: string; message: string; path?: string }>;
}

export interface RepoListReport {
  status: ReportStatus;
  workspace: string;
  repositories: Array<{
    name: string;
    branch: string;
    remote: string;
    path: string;
    installed: boolean;
  }>;
  issues: Array<{ code: string; message: string; path?: string }>;
}

export interface WorkspaceGitReport {
  status: ReportStatus;
  workspace: string;
  command: "checkout" | "pull" | "sync";
  repositories: Array<{
    name: string;
    path: string;
    branch: string;
    status: "updated" | "unchanged" | "failed";
    message?: string;
  }>;
  issues: Array<{ code: string; message: string; path?: string }>;
}
