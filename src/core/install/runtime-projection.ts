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

  await mapWithConcurrency(
    selectedProjectors,
    RUNTIME_PROJECTION_CONCURRENCY_LIMIT,
    async (projector) => {
      await projector.project({ workspaceRoot, resolvedWorkspace });
    },
  );
}
