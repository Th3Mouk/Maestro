import { execa } from "execa";

export type UpstreamState = "tracking" | "gone" | "none";

/** What a branch (or a checkout's HEAD) holds that its remotes and reference branch may not. */
export interface GitRefState {
  /** Current branch of a checkout; `null` when detached or when inspecting a branch directly. */
  branch: string | null;
  /** The ref's work is in the reference ref: ancestor, or squash-equivalent to a commit on it. */
  integrated: boolean;
  /** Commits reachable from the ref and from no remote-tracking ref. */
  localOnly: number;
  upstream: UpstreamState;
}

interface TaskBranch {
  branch: string;
  /** Checked out in a worktree (a task, or a primary clone). */
  checkedOut: boolean;
}

// `git commit-tree` needs an identity even for a throwaway object.
const throwawayIdentity = ["-c", "user.name=maestro", "-c", "user.email=maestro@localhost"];

async function git(repoRoot: string, args: string[]) {
  return execa("git", args, { cwd: repoRoot, reject: false });
}

async function gitOutput(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execa("git", args, { cwd: repoRoot });
  return stdout.trim();
}

export class GitCheckoutInspector {
  /**
   * Inspects `tip` (a checkout's `HEAD` by default, or a branch name) against `referenceRef`
   * (for example `origin/main`).
   */
  async inspect(repoRoot: string, referenceRef: string, tip = "HEAD"): Promise<GitRefState> {
    const branch = tip === "HEAD" ? await this.#currentBranch(repoRoot) : null;
    const [localOnly, upstream, integrated] = await Promise.all([
      this.#countLocalOnly(repoRoot, tip),
      this.#upstreamState(repoRoot, branch ?? (tip === "HEAD" ? null : tip)),
      this.#isIntegrated(repoRoot, tip, referenceRef),
    ]);
    return { branch, integrated, localOnly, upstream };
  }

  /** Branches matching `<prefix>/<task>/<scope>`. */
  async listTaskBranches(repoRoot: string, prefix: string): Promise<TaskBranch[]> {
    const output = await gitOutput(repoRoot, [
      "for-each-ref",
      "--format=%(refname:short)%00%(worktreepath)",
      `refs/heads/${prefix}/`,
    ]);
    return output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [branch, worktreePath] = line.split("\0");
        return { branch, checkedOut: Boolean(worktreePath) };
      })
      .filter(({ branch }) => branch.split("/").length === 3);
  }

  async #currentBranch(repoRoot: string): Promise<string | null> {
    const { exitCode, stdout } = await git(repoRoot, [
      "symbolic-ref",
      "--quiet",
      "--short",
      "HEAD",
    ]);
    return exitCode === 0 ? stdout.trim() : null;
  }

  async #countLocalOnly(repoRoot: string, tip: string): Promise<number> {
    return Number.parseInt(
      await gitOutput(repoRoot, ["rev-list", "--count", tip, "--not", "--remotes"]),
      10,
    );
  }

  async #upstreamState(repoRoot: string, branch: string | null): Promise<UpstreamState> {
    if (!branch) {
      return "none";
    }
    const output = await gitOutput(repoRoot, [
      "for-each-ref",
      "--format=%(upstream)%00%(upstream:track)",
      `refs/heads/${branch}`,
    ]);
    const [upstream, track] = output.split("\0");
    if (!upstream) {
      return "none";
    }
    return track?.includes("gone") ? "gone" : "tracking";
  }

  /**
   * Squash merges with `delete_branch_on_merge` leave branches whose commits no remote holds
   * and that `git branch -d` never sees as merged, so an ancestry check is not enough: the
   * squash of `merge-base..tip` must also be compared, by patch, with the reference commits.
   */
  async #isIntegrated(repoRoot: string, tip: string, referenceRef: string): Promise<boolean> {
    const ancestor = await git(repoRoot, ["merge-base", "--is-ancestor", tip, referenceRef]);
    if (ancestor.exitCode === 0) {
      return true;
    }

    const mergeBase = await git(repoRoot, ["merge-base", tip, referenceRef]);
    if (mergeBase.exitCode !== 0) {
      return false;
    }
    const tree = await gitOutput(repoRoot, ["rev-parse", `${tip}^{tree}`]);
    const squash = await gitOutput(repoRoot, [
      ...throwawayIdentity,
      "commit-tree",
      tree,
      "-p",
      mergeBase.stdout.trim(),
      "-m",
      "maestro integration probe",
    ]);
    const cherry = await gitOutput(repoRoot, ["cherry", referenceRef, squash]);
    return cherry.startsWith("-");
  }
}
