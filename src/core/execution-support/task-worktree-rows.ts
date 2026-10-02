import type { TaskCheckoutState, WorktreeListReport } from "../../report/types.js";

/** The main workspace (its primary clones) in task pickers and the compact list. */
export const mainWorkspaceTaskName = "@root";

/** One task, summarized: which task to open, and which ones can go. */
export interface TaskRow {
  name: string;
  /** Repositories with a worktree, or `all`. */
  repos: string;
  /** Checkouts with uncommitted changes, comma-separated, or `-`. */
  uncommitted: string;
  /** Checkouts with local-only work that is not integrated, comma-separated, or `-`. */
  unlanded: string;
  /** `yes`, or `-`; always `-` for the main workspace. */
  prunable: string;
  /** Since `createdAt`, such as `3d`; empty for the main workspace. */
  age: string;
  /** Extra columns from `listColumns`, by column name. */
  extra: Record<string, string>;
}

/** The main workspace first, then one row per task. */
export function buildTaskRows(
  report: WorktreeListReport,
  options: { allRepositories: string[]; now?: Date },
): TaskRow[] {
  const now = options.now ?? new Date();
  const rootCheckouts = report.root?.checkouts;
  return [
    {
      name: mainWorkspaceTaskName,
      repos: "all",
      uncommitted: rootCheckouts ? listNames(rootCheckouts, (state) => state.dirty) : "?",
      unlanded: rootCheckouts ? listNames(rootCheckouts, isUnlanded) : "?",
      prunable: "-",
      age: "",
      extra: report.root?.columns ?? {},
    },
    ...report.worktrees.map((worktree) => ({
      name: worktree.name,
      repos: sameNames(worktree.repositories, options.allRepositories)
        ? "all"
        : worktree.repositories.join(",") || "-",
      uncommitted: worktree.checkouts ? listNames(worktree.checkouts, (state) => state.dirty) : "?",
      unlanded: worktree.checkouts ? listNames(worktree.checkouts, isUnlanded) : "?",
      prunable: worktree.prunable === undefined ? "?" : worktree.prunable ? "yes" : "-",
      age: formatAge(worktree.createdAt, now),
      extra: worktree.columns ?? {},
    })),
  ];
}

function isUnlanded(state: TaskCheckoutState): boolean {
  return state.localOnly > 0 && !state.integrated;
}

function listNames(
  checkouts: TaskCheckoutState[],
  predicate: (state: TaskCheckoutState) => boolean,
): string {
  const names = checkouts
    .filter((state) => !state.error && predicate(state))
    .map((state) => state.name);
  return names.length > 0 ? names.join(",") : "-";
}

function sameNames(left: string[], right: string[]): boolean {
  return left.length === right.length && right.every((name) => left.includes(name));
}

function formatAge(createdAt: string, now: Date): string {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) {
    return "?";
  }
  const minutes = Math.max(0, Math.floor((now.getTime() - created) / 60_000));
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  return `${Math.floor(hours / 24)}d`;
}
