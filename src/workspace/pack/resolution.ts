import type { PackManifest, PackRef } from "../types.js";
import { loadPackManifest } from "./manifest.js";
import { resolvePackRoot } from "./root-resolution.js";

interface ResolvedPackLocation {
  root: string;
  manifest: PackManifest;
}

export async function resolvePackLocation(
  workspaceRoot: string,
  packRef: PackRef,
): Promise<ResolvedPackLocation> {
  const root = await resolvePackRoot(workspaceRoot, packRef);
  const manifest = await loadPackManifest(root);
  return { root, manifest };
}
