import { createBuiltInProjectors } from "../../adapters/runtimes/index.js";
import type { RuntimeName } from "../../runtime/types.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import { mapWithConcurrency } from "../../utils/fs.js";

const RUNTIME_PROJECTION_CONCURRENCY_LIMIT = 3;

export async function projectWorkspaceRuntimes(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  dryRun: boolean,
): Promise<void> {
  const availableProjectors = createBuiltInProjectors();
  if (dryRun) {
    return;
  }

  const selectedProjectors = availableProjectors.filter((projector) =>
    Boolean(resolvedWorkspace.runtimes[projector.name as RuntimeName]),
  );

  // `standard` runs first: `.claude/skills/<name>` links point into the `.agents/skills/`
  // tree it (re)writes, so the two must not race.
  const [linkTargets, others] = [
    selectedProjectors.filter((projector) => projector.name === "standard"),
    selectedProjectors.filter((projector) => projector.name !== "standard"),
  ];
  for (const projector of linkTargets) {
    await projector.project({ workspaceRoot, resolvedWorkspace });
  }
  await mapWithConcurrency(others, RUNTIME_PROJECTION_CONCURRENCY_LIMIT, async (projector) => {
    await projector.project({ workspaceRoot, resolvedWorkspace });
  });
}
