import {
  GitHubForgeClient,
  type ForgeClient,
  type ForgeName,
} from "../adapters/forge/github-forge.js";
import { launchEditorProcess } from "../adapters/editor/editor-launcher.js";
import { GitAdapter } from "../adapters/git/git-adapter.js";
import type { EditorLaunch } from "./execution/editor-launch.js";
import type { Renderer } from "../cli/output/renderer.js";
import { createRenderer } from "../cli/output/index.js";

export type GitCommandAdapter = Pick<
  GitAdapter,
  | "ensureWorkspaceRepository"
  | "isUnbornRepository"
  | "ensureRepository"
  | "isClean"
  | "listUncommittedChanges"
  | "hasGitMetadata"
  | "getRemoteUrl"
  | "getCurrentBranch"
  | "getChangedFiles"
  | "getCommittedChangedFiles"
  | "commitAll"
  | "ensureWorktree"
  | "fetchBranch"
  | "fetch"
  | "inspectRef"
  | "listTaskBranches"
  | "deleteBranches"
  | "inspectTaskBranches"
  | "readUpstreamBranch"
  | "localBranchExists"
  | "remoteBranchExists"
  | "resolveDefaultBranchRef"
  | "removeWorktree"
  | "listWorktrees"
  | "pruneWorktrees"
  | "checkoutBranch"
  | "pullCurrentBranch"
>;

export interface CommandContext {
  /** Forges `worktree list --status` and `prune` can ask about merged pull requests. */
  forgeClients: Record<ForgeName, ForgeClient>;
  gitAdapter: GitCommandAdapter;
  /** Starts an editor for `worktree open`; rejects when it cannot. */
  launchEditor: (launch: EditorLaunch) => Promise<void>;
  stderr: NodeJS.WriteStream;
  renderer: Renderer;
}

export function createCommandContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    forgeClients: overrides.forgeClients ?? { github: new GitHubForgeClient() },
    gitAdapter: overrides.gitAdapter ?? new GitAdapter(),
    launchEditor: overrides.launchEditor ?? launchEditorProcess,
    stderr: overrides.stderr ?? process.stderr,
    renderer: overrides.renderer ?? createRenderer("json", { reportKind: "install" }),
  };
}
