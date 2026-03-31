import { GitAdapter } from "../adapters/git/git-adapter.js";

export type GitCommandAdapter = Pick<
  GitAdapter,
  | "ensureWorkspaceRepository"
  | "isUnbornRepository"
  | "ensureRepository"
  | "isClean"
  | "hasGitMetadata"
  | "getRemoteUrl"
  | "getCurrentBranch"
  | "getChangedFiles"
  | "getCommittedChangedFiles"
  | "commitAll"
  | "ensureWorktree"
  | "checkoutBranch"
  | "pullCurrentBranch"
>;

export interface CommandContext {
  gitAdapter: GitCommandAdapter;
  stderr: NodeJS.WriteStream;
}

export function createCommandContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    gitAdapter: overrides.gitAdapter ?? new GitAdapter(),
    stderr: overrides.stderr ?? process.stderr,
  };
}
