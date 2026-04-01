import type { PackRef, PackResolution } from "./types.js";
import { mapWithConcurrency } from "../utils/fs.js";
import { ensureManifestCompatibleWithFramework } from "./pack/compatibility.js";
import { DEFAULT_RESOLUTION_CONCURRENCY_LIMIT } from "./pack/constants.js";
import { resolvePackLocation } from "./pack/resolution.js";

export async function resolvePacks(
  workspaceRoot: string,
  packRefs: PackRef[],
  frameworkVersion: string,
  concurrencyLimit: number = DEFAULT_RESOLUTION_CONCURRENCY_LIMIT,
): Promise<PackResolution[]> {
  return mapWithConcurrency(packRefs, concurrencyLimit, async (packRef) => {
    const { root, manifest } = await resolvePackLocation(workspaceRoot, packRef);
    ensureManifestCompatibleWithFramework(manifest, frameworkVersion);
    return { ref: packRef, root, manifest };
  });
}
