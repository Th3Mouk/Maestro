import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import semver from "semver";
import YAML from "yaml";
import type { PackRef, PackResolution } from "./types.js";
import { packManifestSchema } from "./schema.js";
import { mapWithConcurrency, pathExists, readText, resolveSafePath } from "../utils/fs.js";

const DEFAULT_RESOLUTION_CONCURRENCY_LIMIT = 4;
const builtInStarterPackRoot = resolveBuiltInStarterPackRoot();

export async function resolveBuiltInStarterPack(frameworkVersion: string): Promise<PackResolution> {
  const manifestPath = path.join(builtInStarterPackRoot, "pack.yaml");
  const parsed = packManifestSchema.parse(YAML.parse(await readText(manifestPath)));
  ensurePackCompatibleWithFramework(
    parsed.metadata.name,
    parsed.spec.compatibility?.framework,
    frameworkVersion,
  );

  return {
    ref: {
      name: parsed.metadata.name,
      version: parsed.metadata.version,
      visibility: parsed.metadata.visibility,
      source: builtInStarterPackRoot,
    },
    root: builtInStarterPackRoot,
    manifest: parsed,
  };
}

export async function resolvePacks(
  workspaceRoot: string,
  packRefs: PackRef[],
  frameworkVersion: string,
  concurrencyLimit: number = DEFAULT_RESOLUTION_CONCURRENCY_LIMIT,
): Promise<PackResolution[]> {
  return mapWithConcurrency(packRefs, concurrencyLimit, async (packRef) => {
    const root = await resolvePackRoot(workspaceRoot, packRef);
    const manifestPath = path.join(root, "pack.yaml");
    const parsed = packManifestSchema.parse(YAML.parse(await readText(manifestPath)));
    ensurePackCompatibleWithFramework(
      parsed.metadata.name,
      parsed.spec.compatibility?.framework,
      frameworkVersion,
    );
    return { ref: packRef, root, manifest: parsed };
  });
}

async function resolvePackRoot(workspaceRoot: string, packRef: PackRef): Promise<string> {
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

function resolveBuiltInStarterPackRoot(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(currentDir, "../../../framework-packs/starter"),
    path.resolve(currentDir, "../../framework-packs/starter"),
  ];
  const root = candidates.find((candidate) => existsSync(candidate));
  if (!root) {
    throw new Error("Cannot locate the built-in starter pack assets.");
  }
  return root;
}

function ensurePackCompatibleWithFramework(
  packName: string,
  frameworkRange: string | undefined,
  frameworkVersion: string,
): void {
  if (frameworkRange && !semver.satisfies(frameworkVersion, frameworkRange)) {
    throw new Error(`Pack ${packName} is incompatible with framework ${frameworkVersion}`);
  }
}
