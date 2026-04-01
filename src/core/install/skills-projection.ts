import type { ResolvedWorkspace } from "../../workspace/types.js";
import {
  copyDir,
  ensureDir,
  mapWithConcurrency,
  removeIfExists,
  resolveSafePath,
  withWorkspaceLock,
} from "../../utils/fs.js";
import { getWorkspaceStateRoot } from "../../workspace/state-directory.js";

const SKILL_PROJECTION_CONCURRENCY_LIMIT = 4;

export async function projectWorkspaceSkills(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  dryRun: boolean,
): Promise<void> {
  const skillsRoot = getWorkspaceStateRoot(workspaceRoot, "skills");
  if (!dryRun) {
    await withWorkspaceLock(workspaceRoot, async () => {
      await removeIfExists(skillsRoot);
      await ensureDir(skillsRoot);
    });
  }

  if (dryRun) {
    return;
  }

  await withWorkspaceLock(workspaceRoot, async () => {
    await mapWithConcurrency(
      resolvedWorkspace.selectedSkills,
      SKILL_PROJECTION_CONCURRENCY_LIMIT,
      async (skill) => {
        const projectedSkillRoot = resolveSafePath(skillsRoot, skill.name, "skill projection path");
        await copyDir(skill.root, projectedSkillRoot);
      },
    );
  });
}
