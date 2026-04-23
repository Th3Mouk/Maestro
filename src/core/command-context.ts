import { GitAdapter } from "../adapters/git/git-adapter.js";
import type { Renderer } from "../cli/output/renderer.js";
import { createRenderer } from "../cli/output/index.js";

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
  | "removeWorktree"
  | "checkoutBranch"
  | "pullCurrentBranch"
>;

export interface CommandContext {
  gitAdapter: GitCommandAdapter;
  stderr: NodeJS.WriteStream;
  renderer: Renderer;
}

export function createCommandContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    gitAdapter: overrides.gitAdapter ?? new GitAdapter(),
    stderr: overrides.stderr ?? process.stderr,
    renderer: overrides.renderer ?? createRenderer("json"),
  };
}
