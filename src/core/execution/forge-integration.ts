import {
  ForgeUnavailableError,
  type ForgeClient,
  type ForgeName,
} from "../../adapters/forge/github-forge.js";
import type { TaskCheckoutState } from "../../report/types.js";
import { mapWithConcurrency } from "../../utils/fs.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";

type ForgeGitAdapter = {
  getRemoteUrl: (repoRoot: string) => Promise<string>;
  readUpstreamBranch: (repoRoot: string, branchName: string) => Promise<string | undefined>;
};

type ForgeCheckedState = Pick<
  TaskCheckoutState,
  "error" | "integrated" | "integratedBy" | "localOnly" | "pr" | "upstream"
>;

/** A branch to ask the forge about, and the state its answer updates. */
export interface ForgeLookup {
  branch: string;
  repoRoot: string;
  state: ForgeCheckedState;
}

/** `--forge` when given (`none` turns it off), else `spec.execution.worktrees.forge`. */
export function resolveForge(
  requested: ForgeName | "none" | undefined,
  resolvedWorkspace: ResolvedWorkspace,
): ForgeName | undefined {
  if (requested === "none") {
    return undefined;
  }
  return requested ?? resolvedWorkspace.execution.worktrees?.forge;
}

/**
 * Only work the Git checks could not place needs the forge: a squash merge stops being
 * patch-equivalent once the reference branch changed the same lines afterwards, and
 * `delete_branch_on_merge` leaves the branch's upstream gone.
 */
export function needsForgeLookup(state: ForgeCheckedState): boolean {
  return !state.error && state.upstream === "gone" && !state.integrated && state.localOnly > 0;
}

/**
 * Marks as integrated the lookups whose upstream branch was the head of a merged pull
 * request. A forge that cannot be asked yields one `FORGE_UNAVAILABLE` warning, and the
 * states keep their Git-only verdict.
 */
export async function applyForgeIntegration(
  lookups: ForgeLookup[],
  options: {
    client: ForgeClient;
    concurrencyLimit: number;
    forge: ForgeName;
    gitAdapter: ForgeGitAdapter;
  },
): Promise<{ code: string; message: string } | undefined> {
  let unavailable: string | undefined;
  await mapWithConcurrency(lookups, options.concurrencyLimit, async (lookup) => {
    if (unavailable) {
      return;
    }
    try {
      const upstreamBranch = await options.gitAdapter.readUpstreamBranch(
        lookup.repoRoot,
        lookup.branch,
      );
      if (!upstreamBranch) {
        return;
      }
      const remoteUrl = await options.gitAdapter.getRemoteUrl(lookup.repoRoot);
      const pullRequest = await options.client.findMergedPullRequest(remoteUrl, upstreamBranch);
      if (pullRequest) {
        lookup.state.integrated = true;
        lookup.state.integratedBy = "forge";
        lookup.state.pr = pullRequest.number;
      }
    } catch (error) {
      if (error instanceof ForgeUnavailableError) {
        unavailable ??= error.message;
      }
      // Any other failure leaves this branch with its Git-only verdict.
    }
  });

  if (!unavailable) {
    return undefined;
  }
  return {
    code: "FORGE_UNAVAILABLE",
    message: `Could not ask ${options.forge} about merged pull requests: ${unavailable}. Integration was checked with Git only.`,
  };
}
