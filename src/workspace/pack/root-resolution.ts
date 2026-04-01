import path from "node:path";
import type { PackRef } from "../types.js";
import { pathExists, resolveSafePath } from "../../utils/fs.js";

export async function resolvePackRoot(workspaceRoot: string, packRef: PackRef): Promise<string> {
  if (packRef.source) {
    const candidate = path.isAbsolute(packRef.source)
      ? path.resolve(packRef.source)
      : path.resolve(workspaceRoot, packRef.source);

    if (isWithinAllowedRoot(workspaceRoot, candidate)) {
      return candidate;
    }

    throw new Error(`pack source escapes the allowed root: ${packRef.source}`);
  }

  const nodeModulesRoot = resolveSafePath(workspaceRoot, "node_modules", "node_modules root");
  const direct = resolveSafePath(nodeModulesRoot, packRef.name, "pack name");
  if (await pathExists(direct)) {
    return direct;
  }

  throw new Error(
    `Cannot resolve pack ${packRef.name}. Use spec.packs[].source or install the package.`,
  );
}

function isWithinAllowedRoot(workspaceRoot: string, candidate: string): boolean {
  const allowedRoot = path.resolve(workspaceRoot, "..");
  const relativeToAllowedRoot = path.relative(allowedRoot, candidate);
  return (
    relativeToAllowedRoot === "" ||
    (!relativeToAllowedRoot.startsWith("..") && !path.isAbsolute(relativeToAllowedRoot))
  );
}
