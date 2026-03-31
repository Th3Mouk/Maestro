import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import lockfile from "proper-lockfile";
import { workspaceStateDirName } from "../workspace/state-directory.js";

export async function ensureDir(target: string): Promise<void> {
  await mkdir(target, { recursive: true });
}

export async function readText(target: string): Promise<string> {
  return readFile(target, "utf8");
}

export async function writeText(target: string, content: string): Promise<void> {
  await ensureDir(path.dirname(target));
  await writeFile(target, content, "utf8");
}

export async function writeJson(target: string, value: unknown): Promise<void> {
  await writeText(target, `${stableStringify(value)}\n`);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value), null, 2);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, sortValue(entry)]);
    return Object.fromEntries(entries);
  }

  return value;
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export async function copyDir(source: string, destination: string): Promise<void> {
  await cp(source, destination, {
    force: true,
    recursive: true,
  });
}

export async function mapWithConcurrency<T, TResult>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<TResult>,
): Promise<TResult[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error(`Invalid concurrency: ${concurrency}`);
  }

  if (values.length === 0) {
    return [];
  }

  const results = new Array<TResult>(values.length);
  let nextIndex = 0;
  let shouldStop = false;
  let hasError = false;
  let firstError: unknown;
  const workerCount = Math.min(concurrency, values.length);

  const workers = Array.from({ length: workerCount }, async () => {
    while (!shouldStop) {
      const index = nextIndex++;
      if (index >= values.length) {
        return;
      }

      try {
        results[index] = await mapper(values[index]!, index);
      } catch (error) {
        if (!hasError) {
          hasError = true;
          firstError = error;
          shouldStop = true;
        }
        return;
      }
    }
  });

  await Promise.all(workers);
  if (hasError) {
    throw firstError;
  }
  return results;
}

export async function removeIfExists(target: string): Promise<void> {
  if (existsSync(target)) {
    await rm(target, { recursive: true, force: true });
  }
}

export async function listDirectories(root: string): Promise<string[]> {
  if (!(await pathExists(root))) {
    return [];
  }

  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

export async function createTempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

export function resolveSafePath(root: string, targetPath: string, label = "path"): string {
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, targetPath);
  const relativePath = path.relative(resolvedRoot, resolvedPath);

  if (relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))) {
    return resolvedPath;
  }

  throw new Error(`${label} escapes the allowed root: ${targetPath}`);
}

export async function withWorkspaceLock<T>(
  workspaceRoot: string,
  callback: () => Promise<T>,
): Promise<T> {
  const lockRoot = path.join(workspaceRoot, workspaceStateDirName);
  await ensureDir(lockRoot);

  const release = await lockfile.lock(lockRoot, {
    realpath: false,
    retries: {
      retries: 8,
      factor: 1.25,
      minTimeout: 50,
      maxTimeout: 500,
    },
  });

  try {
    return await callback();
  } finally {
    await release();
  }
}
