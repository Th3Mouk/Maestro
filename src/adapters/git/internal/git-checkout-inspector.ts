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

/** Runs one `git` invocation; never rejects, so callers decide what an exit code means. */
type GitRunner = (
  repoRoot: string,
  args: string[],
) => Promise<{ exitCode?: number; stderr: string; stdout: string }>;

const runGit: GitRunner = async (repoRoot, args) => {
  const { exitCode, stderr, stdout } = await execa("git", args, { cwd: repoRoot, reject: false });
  return { exitCode, stderr: String(stderr), stdout: String(stdout) };
};

/** A task branch with what `prune --branches` needs to decide about it. */
export interface TaskBranchState {
  branch: string;
  /** Checked out in a worktree (a task, or a primary clone). */
  checkedOut: boolean;
  /** Its tip is in the reference ref (ancestor), or its squash is patch-equivalent to a commit there. */
  integrated: boolean;
  /** Commits no remote-tracking ref holds; only counted for branches that are not ancestors. */
  localOnly: number;
  upstream: UpstreamState;
}

export class GitCheckoutInspector {
  readonly #run: GitRunner;

  constructor(run: GitRunner = runGit) {
    this.#run = run;
  }

  async #git(repoRoot: string, args: string[]) {
    return this.#run(repoRoot, args);
  }

  async #gitOutput(repoRoot: string, args: string[]): Promise<string> {
    const { exitCode, stderr, stdout } = await this.#run(repoRoot, args);
    if (exitCode !== 0) {
      throw new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`);
    }
    return stdout.trim();
  }

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
    const output = await this.#gitOutput(repoRoot, [
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

  /**
   * Every task branch of a repository in one pass: one `for-each-ref` for branches, worktrees
   * and upstream tracking, one `for-each-ref --merged` for the branches whose tip is in
   * `referenceRef`, then the local-only count and the patch check only for the others. The
   * number of Git invocations grows with the branches holding unintegrated work, not with all
   * of them.
   */
  async inspectTaskBranches(
    repoRoot: string,
    prefix: string,
    referenceRef: string,
  ): Promise<TaskBranchState[]> {
    const output = await this.#gitOutput(repoRoot, [
      "for-each-ref",
      "--format=%(refname:short)%00%(worktreepath)%00%(upstream)%00%(upstream:track)",
      `refs/heads/${prefix}/`,
    ]);
    const branches = output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [branch = "", worktreePath, upstream, track] = line.split("\0");
        const upstreamState: UpstreamState = !upstream
          ? "none"
          : track?.includes("gone")
            ? "gone"
            : "tracking";
        return { branch, checkedOut: Boolean(worktreePath), upstream: upstreamState };
      })
      .filter(({ branch }) => branch.split("/").length === 3);
    if (branches.length === 0) {
      return [];
    }

    const merged = await this.#git(repoRoot, [
      "for-each-ref",
      "--format=%(refname:short)",
      `--merged=${referenceRef}`,
      `refs/heads/${prefix}/`,
    ]);
    const ancestors = new Set(
      merged.exitCode === 0 ? merged.stdout.split("\n").filter(Boolean) : [],
    );

    const states: TaskBranchState[] = [];
    for (const branch of branches) {
      if (branch.checkedOut || ancestors.has(branch.branch)) {
        // A checked-out branch belongs to a worktree and is never an orphan to inspect.
        states.push({ ...branch, integrated: ancestors.has(branch.branch), localOnly: 0 });
        continue;
      }
      const localOnly = await this.#countLocalOnly(repoRoot, branch.branch);
      const integrated =
        localOnly > 0 && (await this.#isPatchIntegrated(repoRoot, branch.branch, referenceRef));
      states.push({ ...branch, integrated, localOnly });
    }
    return states;
  }

  /** The remote branch `branch` tracks (`refs/heads/` stripped), even when it is gone. */
  async upstreamBranch(repoRoot: string, branch: string): Promise<string | undefined> {
    const output = await this.#gitOutput(repoRoot, [
      "for-each-ref",
      "--format=%(upstream:remoteref)",
      `refs/heads/${branch}`,
    ]);
    return output.replace(/^refs\/heads\//, "") || undefined;
  }

  async #currentBranch(repoRoot: string): Promise<string | null> {
    const { exitCode, stdout } = await this.#git(repoRoot, [
      "symbolic-ref",
      "--quiet",
      "--short",
      "HEAD",
    ]);
    return exitCode === 0 ? stdout.trim() : null;
  }

  async #countLocalOnly(repoRoot: string, tip: string): Promise<number> {
    return Number.parseInt(
      await this.#gitOutput(repoRoot, ["rev-list", "--count", tip, "--not", "--remotes"]),
      10,
    );
  }

  async #upstreamState(repoRoot: string, branch: string | null): Promise<UpstreamState> {
    if (!branch) {
      return "none";
    }
    const output = await this.#gitOutput(repoRoot, [
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
    const ancestor = await this.#git(repoRoot, ["merge-base", "--is-ancestor", tip, referenceRef]);
    if (ancestor.exitCode === 0) {
      return true;
    }
    return this.#isPatchIntegrated(repoRoot, tip, referenceRef);
  }

  async #isPatchIntegrated(repoRoot: string, tip: string, referenceRef: string): Promise<boolean> {
    const mergeBase = await this.#git(repoRoot, ["merge-base", tip, referenceRef]);
    if (mergeBase.exitCode !== 0) {
      return false;
    }
    const tree = await this.#gitOutput(repoRoot, ["rev-parse", `${tip}^{tree}`]);
    const squash = await this.#gitOutput(repoRoot, [
      ...throwawayIdentity,
      "commit-tree",
      tree,
      "-p",
      mergeBase.stdout.trim(),
      "-m",
      "maestro integration probe",
    ]);
    const cherry = await this.#gitOutput(repoRoot, ["cherry", referenceRef, squash]);
    return cherry.startsWith("-");
  }
}
