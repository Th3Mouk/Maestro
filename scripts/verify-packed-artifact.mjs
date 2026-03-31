import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactDir = path.join(repoRoot, ".artifacts");

async function main() {
  const tarball = await findTarball();
  const contents = await listTarballContents(tarball);

  assertNoMatch(
    contents,
    /^package\/\.agents\//,
    "internal harness files must not be shipped in the npm package",
  );
  assertNoMatch(
    contents,
    /^package\/\.codex\//,
    "internal maintainer Codex files must not be shipped in the npm package",
  );
  assertNoMatch(
    contents,
    /^package\/\.claude\//,
    "internal maintainer Claude files must not be shipped in the npm package",
  );
  assertNoMatch(
    contents,
    /^package\/docs\/internals\//,
    "internal governance docs must not be shipped in the npm package",
  );
  assertNoMatch(
    contents,
    /^package\/docs\/harness\//,
    "internal harness docs must not be shipped in the npm package",
  );
  assertNoMatch(
    contents,
    /^package\/docs\/project-language\//,
    "internal narrative docs must not be shipped in the npm package",
  );
  assertNoMatch(
    contents,
    /^package\/examples\/.*\/\.workspace\//,
    "generated example workspace state must not be shipped in the npm package",
  );
  assertMatch(
    contents,
    /^package\/framework-packs\/starter\/pack\.yaml$/,
    "starter pack manifest must be shipped in the npm package",
  );
  assertMatch(
    contents,
    /^package\/npm-shrinkwrap\.json$/,
    "npm-shrinkwrap.json must be shipped in the npm package",
  );

  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "maestro-pack-"));

  try {
    await execa("npm", ["init", "-y"], { cwd: tempRoot, stdio: "pipe" });
    await execa("npm", ["install", tarball], { cwd: tempRoot, stdio: "pipe" });
    await execa("npm", ["audit", "signatures"], { cwd: tempRoot, stdio: "pipe" });

    const binPath = path.join(tempRoot, "node_modules", ".bin", "maestro");
    await execa(binPath, ["--help"], { cwd: tempRoot, stdio: "pipe" });
    await assertShrinkwrapMatchesInstalledTree(tempRoot);

    const initWorkspace = path.join(tempRoot, "sample-workspace");
    await execa(binPath, ["init", initWorkspace], { cwd: tempRoot, stdio: "pipe" });
    await assertFileExists(path.join(initWorkspace, "maestro.yaml"));
    await assertFileExists(path.join(initWorkspace, "AGENTS.md"));
    await assertFileExists(path.join(initWorkspace, "maestro.json"));
    await assertFileExists(path.join(initWorkspace, ".gitignore"));
    assertPathExists(path.join(initWorkspace, ".maestro"));
    await assertFileContains(path.join(initWorkspace, "package.json"), '"maestro"');
    await assertFileContains(path.join(initWorkspace, "README.md"), "maestro.json");

    await assertFileContains(
      path.join(
        tempRoot,
        "node_modules",
        "@th3mouk",
        "maestro",
        "framework-packs",
        "starter",
        "pack.yaml",
      ),
      "@maestro/starter-pack",
    );

    const exampleWorkspace = path.join(
      tempRoot,
      "node_modules",
      "@th3mouk",
      "maestro",
      "examples",
      "ops-workspace",
    );
    await execa(binPath, ["install", "--workspace", exampleWorkspace, "--dry-run"], {
      cwd: tempRoot,
      stdio: "pipe",
    });
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function findTarball() {
  const entries = await readdir(artifactDir);
  const tarball = entries.find((entry) => entry.endsWith(".tgz"));

  if (!tarball) {
    throw new Error(`No tarball found in ${artifactDir}`);
  }

  return path.join(artifactDir, tarball);
}

async function listTarballContents(tarball) {
  const { stdout } = await execa("tar", ["-tzf", tarball], {
    cwd: repoRoot,
    stdio: "pipe",
  });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function assertNoMatch(contents, pattern, message) {
  const match = contents.find((entry) => pattern.test(entry));
  if (match) {
    throw new Error(`${message}: ${match}`);
  }
}

function assertMatch(contents, pattern, message) {
  const match = contents.find((entry) => pattern.test(entry));
  if (!match) {
    throw new Error(message);
  }
}

async function assertFileExists(targetPath) {
  await readFile(targetPath, "utf8");
}

async function assertFileContains(targetPath, expected) {
  const content = await readFile(targetPath, "utf8");
  if (!content.includes(expected)) {
    throw new Error(`Expected ${targetPath} to contain ${expected}`);
  }
}

async function assertShrinkwrapMatchesInstalledTree(tempRoot) {
  const shrinkwrap = JSON.parse(await readFile(path.join(repoRoot, "npm-shrinkwrap.json"), "utf8"));
  const installedLock = JSON.parse(
    await readFile(path.join(tempRoot, "package-lock.json"), "utf8"),
  );

  const shrinkwrapPackages = Object.entries(shrinkwrap.packages)
    .filter(([entryPath, entry]) => entryPath && entryPath !== "" && !entry.dev)
    .map(([entryPath, entry]) => [entryPath, entry.version]);
  const mismatches = [];

  for (const [entryPath, expectedVersion] of shrinkwrapPackages) {
    const installedEntry = installedLock.packages[entryPath];
    if (!installedEntry) {
      mismatches.push(`${entryPath}: missing from installed tree`);
      continue;
    }
    if (installedEntry.version !== expectedVersion) {
      mismatches.push(
        `${entryPath}: expected ${expectedVersion}, received ${installedEntry.version}`,
      );
    }
  }

  if (mismatches.length > 0) {
    throw new Error(`packed install did not honor npm-shrinkwrap.json:\n${mismatches.join("\n")}`);
  }
}

function assertPathExists(targetPath) {
  if (!existsSync(targetPath)) {
    throw new Error(`Expected path to exist: ${targetPath}`);
  }
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
  );
  process.exitCode = 1;
});
