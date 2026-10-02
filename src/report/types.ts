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
    state: "executed" | "skipped" | "failed";
  }>;
  issues: Array<{ code: string; message: string; path?: string }>;
}

/** A worktree lifecycle hook command: run, failed, or (with `--dry-run`) planned. */
export interface WorktreeHookRun {
  hook: "postCreate" | "preRemove";
  command: string;
  status: "ok" | "failed" | "planned";
  exitCode?: number;
  /** The task the command ran for, in a `prune` report. */
  task?: string;
}

/** `reused`: the task branch already existed and was checked out as is, keeping its commits. */
export type TaskWorktreeCheckoutStatus = "created" | "reused" | "unchanged";

export interface TaskWorktreeReport {
  status: ReportStatus;
  workspace: string;
  name: string;
  root: string;
  repositories: Array<{
    name: string;
    path: string;
    branch: string;
    status: TaskWorktreeCheckoutStatus;
  }>;
  /** Present when the workspace declares `postCreate` hooks. */
  hooks?: WorktreeHookRun[];
  issues: Array<{ code: string; message: string; path?: string }>;
}

export interface DoctorReport {
  status: ReportStatus;
  workspace: string;
  issues: Array<{ code: string; message: string; path?: string }>;
  /** With `--fix`: what doctor repaired. */
  fixes?: Array<{ code: string; message: string; path?: string }>;
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
  /** Present when the workspace declares `preRemove` hooks. */
  hooks?: WorktreeHookRun[];
  issues: Array<{ code: string; message: string; path?: string; changedFiles?: number }>;
}

/** State of one checkout of a task: the workspace-root worktree or a repository worktree. */
export interface TaskCheckoutState {
  name: string;
  path: string;
  /** Current branch, `null` when detached. */
  branch: string | null;
  /** Uncommitted changes, untracked files included and ignored files excluded. */
  dirty: boolean;
  /** Commits that no remote-tracking ref holds. */
  localOnly: number;
  upstream: "tracking" | "gone" | "none";
  /** The branch's work is in the reference branch, merged or squash-merged. */
  integrated: boolean;
  /** How `integrated` was established: Git ancestry or patch, or a merged pull request. */
  integratedBy?: "git" | "forge";
  /** With `integratedBy: "forge"`: the merged pull request. */
  pr?: number;
  /** Set when Git could not inspect the checkout; the other fields are then meaningless. */
  error?: string;
}

/** A directory under the worktrees root that `maestro worktree create` did not create. */
export interface ForeignDirectory {
  path: string;
  kind: "git-worktree" | "git-repository" | "directory";
  /** For a `git-worktree`: the repository it belongs to. */
  source?: string;
}

export interface WorktreeListReport {
  status: ReportStatus;
  workspace: string;
  worktrees: Array<{
    name: string;
    root: string;
    createdAt: string;
    /** Repositories that have a worktree in the task. */
    repositories: string[];
    /** With `--status`: the workspace root first, then each repository. */
    checkouts?: TaskCheckoutState[];
    /** With `--status`: whether `worktree prune` would remove the task. */
    prunable?: boolean;
  }>;
  /** Directories under the worktrees root that are not task worktrees; Maestro never touches them. */
  foreign?: ForeignDirectory[];
  issues: Array<{ code: string; message: string; path?: string }>;
}

export interface WorktreePruneReport {
  status: ReportStatus;
  workspace: string;
  dryRun: boolean;
  /** Tasks removed (or, with `--dry-run`, that would be). */
  removed: string[];
  /** Branches deleted (or, with `--dry-run`, that would be), per checkout or repository. */
  deletedBranches: Array<{ name: string; branch: string }>;
  /** Tasks and orphan branches left in place, each with why. */
  kept: Array<{ name: string; reasons: string[] }>;
  /** Merged pull requests that proved a removed task or deleted branch landed (`--forge`). */
  mergedPullRequests?: Array<{ item: string; checkout: string; pr: number }>;
  /** `preRemove` hooks run (or planned) for the removed tasks. */
  hooks?: WorktreeHookRun[];
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
