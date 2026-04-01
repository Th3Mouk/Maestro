import path from "node:path";
import { mapWithConcurrency, pathExists } from "../../utils/fs.js";
import { DEFAULT_FRAGMENT_NAMES, RESOLUTION_CONCURRENCY_LIMIT } from "./constants.js";
import { parseWorkspaceIncludes } from "./schemas.js";

export async function discoverWorkspaceIncludePaths(
  workspaceRoot: string,
  baseContent: Record<string, unknown>,
): Promise<string[]> {
  const declaredIncludes = parseWorkspaceIncludes(baseContent);
  const defaultIncludes = await listExistingDefaultIncludes(workspaceRoot);
  return uniqueIncludePaths([...declaredIncludes, ...defaultIncludes]);
}

async function listExistingDefaultIncludes(workspaceRoot: string): Promise<string[]> {
  const includeCandidates = await mapWithConcurrency(
    DEFAULT_FRAGMENT_NAMES,
    RESOLUTION_CONCURRENCY_LIMIT,
    async (fragmentName) => {
      const fragmentPath = path.join("fragments", `${fragmentName}.yaml`);
      return (await pathExists(path.join(workspaceRoot, fragmentPath))) ? fragmentPath : undefined;
    },
  );

  return includeCandidates.filter((candidate): candidate is string => candidate !== undefined);
}

function uniqueIncludePaths(includePaths: readonly string[]): string[] {
  return Array.from(new Set(includePaths));
}
