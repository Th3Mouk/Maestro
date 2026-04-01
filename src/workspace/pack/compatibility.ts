import semver from "semver";
import type { PackManifest } from "../types.js";

function ensurePackCompatibleWithFramework(
  packName: string,
  frameworkRange: string | undefined,
  frameworkVersion: string,
): void {
  if (frameworkRange && !semver.satisfies(frameworkVersion, frameworkRange)) {
    throw new Error(`Pack ${packName} is incompatible with framework ${frameworkVersion}`);
  }
}

export function ensureManifestCompatibleWithFramework(
  manifest: Pick<PackManifest, "metadata" | "spec">,
  frameworkVersion: string,
): void {
  ensurePackCompatibleWithFramework(
    manifest.metadata.name,
    manifest.spec.compatibility?.framework,
    frameworkVersion,
  );
}
