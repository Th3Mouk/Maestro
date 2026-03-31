import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

interface PackageMetadata {
  version: string;
}

const packageMetadataSchema = z.object({
  name: z.string().optional(),
  version: z.string().min(1),
});

function readPackageMetadata(): PackageMetadata {
  let currentDir = path.dirname(fileURLToPath(import.meta.url));

  while (true) {
    const packageJsonPath = path.join(currentDir, "package.json");

    try {
      const packageJson = packageMetadataSchema.parse(
        JSON.parse(readFileSync(packageJsonPath, "utf8")),
      );
      if (packageJson.version) {
        return { version: packageJson.version };
      }
    } catch {
      // Continue walking up until a matching package.json is found.
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }
    currentDir = parentDir;
  }

  throw new Error("Unable to resolve the Maestro package version from package.json");
}

const packageMetadata = readPackageMetadata();

export function getFrameworkVersion(): string {
  return packageMetadata.version;
}

export function getFrameworkRange(): string {
  return `^${getFrameworkVersion()}`;
}
