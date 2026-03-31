import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binDir = path.join(repoRoot, "bin");
const binPath = path.join(binDir, "maestro.js");

const content = [
  "#!/usr/bin/env node",
  'import { createProgram } from "../dist/src/cli/main.js";',
  "",
  "createProgram()",
  "  .parseAsync(process.argv)",
  "  .catch((error) => {",
  "    process.stderr.write(",
  "      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\\n`,",
  "    );",
  "    process.exitCode = 1;",
  "  });",
  "",
].join("\n");

await mkdir(binDir, { recursive: true });
await writeFile(binPath, content, { mode: 0o755 });
console.log(`wrote ${path.relative(repoRoot, binPath)}`);
