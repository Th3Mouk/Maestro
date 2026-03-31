import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [tree] = JSON.parse(
  execFileSync("pnpm", ["list", "--prod", "--depth", "Infinity", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
  }),
);
const seen = new Set();
const lifecyclePackages = [];
let packageCount = 0;

for (const dependency of Object.values(tree.dependencies ?? {})) {
  walk(dependency);
}

if (lifecyclePackages.length > 0) {
  const rendered = lifecyclePackages
    .map((entry) => `${entry.name}@${entry.version}: ${entry.lifecycle.join(", ")}`)
    .join("\n");
  throw new Error(`runtime dependency lifecycle scripts are not allowed by default:\n${rendered}`);
}

process.stdout.write(
  `verified runtime dependency surface: ${Object.keys(tree.dependencies ?? {}).length} direct, ${packageCount} total, 0 lifecycle scripts\n`,
);

function walk(dependency) {
  if (!dependency || !dependency.path || seen.has(dependency.path)) {
    return;
  }

  seen.add(dependency.path);
  packageCount += 1;

  const manifest = JSON.parse(readFileSync(path.join(dependency.path, "package.json"), "utf8"));
  const scripts = manifest.scripts ?? {};
  const lifecycle = ["preinstall", "install", "postinstall"].filter((name) => scripts[name]);

  if (lifecycle.length > 0) {
    lifecyclePackages.push({
      lifecycle,
      name: manifest.name,
      version: manifest.version,
    });
  }

  for (const child of Object.values(dependency.dependencies ?? {})) {
    walk(child);
  }
}
