import path from "node:path";
import type { DoctorReport } from "../../report/types.js";
import { resolveRealPath, resolveSafePath } from "../../utils/fs.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import type { GitCommandAdapter } from "../command-context.js";
import { errorMessage } from "../errors.js";
import { getTaskWorktreesRoot } from "../execution-support/worktree-root.js";
import { pushDoctorWarning } from "./reporting.js";

type WorktreeCheckGitAdapter = Pick<
  GitCommandAdapter,
  "hasGitMetadata" | "listWorktrees" | "pruneWorktrees"
>;

/**
 * Task worktrees Maestro cannot see from `rootDir`: workspace-root worktrees created
 * elsewhere (by another tool, or by hand), tasks nested in another task by older
 * invocations, and registrations whose directory was deleted.
 */
export async function runWorktreeChecks(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  gitAdapter: WorktreeCheckGitAdapter,
  report: DoctorReport,
  options: { fix?: boolean } = {},
): Promise<void> {
  if (!(await gitAdapter.hasGitMetadata(workspaceRoot))) {
    return;
  }

  if (resolvedWorkspace.execution.worktrees?.enabled) {
    await checkWorkspaceRootWorktrees(workspaceRoot, resolvedWorkspace, gitAdapter, report);
  }

  const sources = [
    { name: resolvedWorkspace.manifest.metadata.name, root: workspaceRoot },
    ...resolvedWorkspace.repositories.map((repository) => ({
      name: repository.name,
      root: resolveSafePath(
        workspaceRoot,
        path.join("repos", repository.name),
        "workspace repository path",
      ),
    })),
  ];
  for (const source of sources) {
    if (await gitAdapter.hasGitMetadata(source.root)) {
      await checkPrunableWorktrees(source, gitAdapter, report, options.fix ?? false);
    }
  }
}

async function checkWorkspaceRootWorktrees(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  gitAdapter: WorktreeCheckGitAdapter,
  report: DoctorReport,
): Promise<void> {
  // `git worktree list` prints resolved paths, so compare against the resolved rootDir.
  const worktreesRoot = await resolveRealPath(
    getTaskWorktreesRoot(workspaceRoot, resolvedWorkspace),
  );
  const worktrees = (await gitAdapter.listWorktrees(workspaceRoot)).filter(
    (worktree) => !worktree.main && !worktree.prunable,
  );

  for (const worktree of worktrees) {
    const parent = worktrees.find(
      (other) => other !== worktree && isInside(worktree.path, other.path),
    );
    if (parent) {
      pushDoctorWarning(report, {
        code: "TASK_NESTED",
        message: `Workspace worktree ${worktree.path} is nested in the task worktree ${parent.path}; remove it from there and recreate it with \`maestro worktree create\`.`,
        path: worktree.path,
      });
    } else if (!isInside(worktree.path, worktreesRoot)) {
      pushDoctorWarning(report, {
        code: "TASK_OUTSIDE_ROOT",
        message: `Workspace worktree ${worktree.path}${worktree.branch ? ` (${worktree.branch})` : ""} is outside ${worktreesRoot}; \`maestro worktree list\` and \`prune\` do not see it.`,
        path: worktree.path,
      });
    }
  }
}

async function checkPrunableWorktrees(
  source: { name: string; root: string },
  gitAdapter: WorktreeCheckGitAdapter,
  report: DoctorReport,
  fix: boolean,
): Promise<void> {
  const prunable = (await gitAdapter.listWorktrees(source.root)).filter(
    (worktree) => worktree.prunable,
  );
  if (prunable.length === 0) {
    return;
  }

  if (fix) {
    try {
      await gitAdapter.pruneWorktrees(source.root);
      report.fixes = [
        ...(report.fixes ?? []),
        ...prunable.map((worktree) => ({
          code: "WORKTREE_PRUNABLE",
          message: `Pruned the registration of ${worktree.path} in ${source.name} (\`git worktree prune\`).`,
          path: worktree.path,
        })),
      ];
      return;
    } catch (error) {
      pushDoctorWarning(report, {
        code: "WORKTREE_PRUNE_FAILED",
        message: `git worktree prune failed in ${source.name}: ${errorMessage(error)}`,
        path: source.root,
      });
    }
  }

  for (const worktree of prunable) {
    pushDoctorWarning(report, {
      code: "WORKTREE_PRUNABLE",
      message: `${source.name} still registers the worktree ${worktree.path}, whose directory is gone; \`maestro workspace doctor --fix\` runs \`git worktree prune\`.`,
      path: worktree.path,
    });
  }
}

function isInside(candidate: string, parent: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}
