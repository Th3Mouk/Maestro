import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { mapWithConcurrency, resolveSafePath } from "../../utils/fs.js";

/**
 * Fingerprints of the files Maestro itself wrote into a task root (workspace descriptor,
 * overlay copies) that differ from the task branch, keyed by path relative to the task root.
 * `null` records a file the overlay removed.
 */
export type GeneratedFileFingerprints = Record<string, string | null>;

const FINGERPRINT_CONCURRENCY_LIMIT = 8;

async function fingerprintPath(absolutePath: string): Promise<string | null> {
  try {
    const stats = await lstat(absolutePath);
    const hash = createHash("sha256");
    if (stats.isSymbolicLink()) {
      hash.update(`symlink:${await readlink(absolutePath)}`);
    } else {
      hash.update(await readFile(absolutePath));
    }
    return hash.digest("hex");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function fingerprintGeneratedFiles(
  taskRoot: string,
  relativePaths: string[],
): Promise<GeneratedFileFingerprints> {
  const entries = await mapWithConcurrency(
    relativePaths,
    FINGERPRINT_CONCURRENCY_LIMIT,
    async (relativePath) =>
      [
        relativePath,
        await fingerprintPath(resolveSafePath(taskRoot, relativePath, "generated file path")),
      ] as const,
  );
  return Object.fromEntries(entries);
}

/**
 * Drops the changes that are still exactly what Maestro wrote, so only work done in the task
 * root counts as uncommitted.
 */
export async function excludeGeneratedChanges(
  taskRoot: string,
  changedPaths: string[],
  generatedFiles: GeneratedFileFingerprints | undefined,
): Promise<string[]> {
  if (!generatedFiles) {
    return changedPaths;
  }

  const kept = await mapWithConcurrency(
    changedPaths,
    FINGERPRINT_CONCURRENCY_LIMIT,
    async (relativePath) => {
      if (!Object.hasOwn(generatedFiles, relativePath)) {
        return relativePath;
      }
      const current = await fingerprintPath(
        resolveSafePath(taskRoot, relativePath, "generated file path"),
      );
      return current === generatedFiles[relativePath] ? undefined : relativePath;
    },
  );
  return kept.filter((relativePath): relativePath is string => relativePath !== undefined);
}
