import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflowPath = path.resolve(repoRoot, process.argv[2] ?? ".github/workflows/release.yml");

const workflow = await readFile(workflowPath, "utf8");

assertMatch(
  /^permissions:\s*[\s\S]*?^\s*id-token:\s*write\s*$/m,
  "release workflow must request id-token: write for GitHub Actions OIDC provenance",
);
assertMatch(
  /^permissions:\s*[\s\S]*?^\s*contents:\s*write\s*$/m,
  "release workflow must keep contents: write for release commits and tags",
);
assertMatch(
  /npm publish\b[^\n]*\s--provenance(?:\s|$)/m,
  "release workflow must publish with npm --provenance",
);
assertMatch(
  /actions\/setup-node@v\d[\s\S]*?registry-url:\s*https:\/\/registry\.npmjs\.org/m,
  "release workflow must configure actions/setup-node with the npm registry URL",
);

process.stdout.write(
  `verified release provenance contract in ${path.relative(repoRoot, workflowPath)}\n`,
);

function assertMatch(pattern, message) {
  if (!pattern.test(workflow)) {
    throw new Error(message);
  }
}
