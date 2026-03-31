import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const shrinkwrapPath = path.join(repoRoot, "npm-shrinkwrap.json");
const writeMode = process.argv.includes("--write");

const tempRoot = await mkdtemp(path.join(os.tmpdir(), "maestro-shrinkwrap-"));

try {
  await cp(packageJsonPath, path.join(tempRoot, "package.json"));

  const install = spawnSync("npm", ["install", "--package-lock-only", "--ignore-scripts"], {
    cwd: tempRoot,
    encoding: "utf8",
    stdio: "pipe",
  });

  if (install.status !== 0) {
    throw new Error(
      `npm install --package-lock-only failed:\n${(install.stderr || install.stdout).trim()}`,
    );
  }

  const generatedPath = path.join(tempRoot, "package-lock.json");
  const generatedContent = await readFile(generatedPath, "utf8");
  const normalizedGenerated = normalizeJson(generatedContent);

  if (writeMode) {
    await writeFile(shrinkwrapPath, `${normalizedGenerated}\n`);
    const format = spawnSync(
      "pnpm",
      ["exec", "oxfmt", "--config", ".oxfmtrc.json", "--write", "npm-shrinkwrap.json"],
      {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: "pipe",
      },
    );

    if (format.status !== 0) {
      throw new Error(`oxfmt failed:\n${(format.stderr || format.stdout || "").trim()}`);
    }

    process.stdout.write("updated npm-shrinkwrap.json from package.json\n");
    process.exit(0);
  }

  const currentContent = await readFile(shrinkwrapPath, "utf8").catch(() => null);
  if (currentContent === null || normalizeJson(currentContent) !== normalizedGenerated) {
    throw new Error("npm-shrinkwrap.json is out of date. Run `pnpm sync:npm-shrinkwrap`.");
  }

  process.stdout.write("verified npm-shrinkwrap.json matches package.json\n");
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

function normalizeJson(content) {
  return JSON.stringify(stripNpmLockfileNoise(JSON.parse(content)));
}

function stripNpmLockfileNoise(value) {
  if (Array.isArray(value)) {
    return value.map(stripNpmLockfileNoise);
  }

  if (value && typeof value === "object") {
    const entries = Object.entries(value).filter(([key]) => key !== "libc");
    return Object.fromEntries(
      entries.map(([key, entryValue]) => [key, stripNpmLockfileNoise(entryValue)]),
    );
  }

  return value;
}
