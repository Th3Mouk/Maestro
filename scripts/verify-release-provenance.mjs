import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const prepareWorkflowPath = path.resolve(repoRoot, ".github/workflows/release.yml");
const publishWorkflowPath = path.resolve(repoRoot, ".github/workflows/publish-release.yml");

const [prepareWorkflow, publishWorkflow] = await Promise.all([
  readFile(prepareWorkflowPath, "utf8"),
  readFile(publishWorkflowPath, "utf8"),
]);

assertMatch(
  /^permissions:\s*[\s\S]*?^\s*id-token:\s*write\s*$/m,
  publishWorkflow,
  "publish workflow must request id-token: write for GitHub Actions OIDC provenance",
);
assertMatch(
  /^permissions:\s*[\s\S]*?^\s*contents:\s*write\s*$/m,
  publishWorkflow,
  "publish workflow must keep contents: write for release tags and GitHub releases",
);
assertMatch(
  /npm publish\b[^\n]*\s--provenance(?:\s|$)/m,
  publishWorkflow,
  "publish workflow must publish with npm --provenance",
);
assertMatch(
  /actions\/setup-node@v\d[\s\S]*?registry-url:\s*https:\/\/registry\.npmjs\.org/m,
  publishWorkflow,
  "publish workflow must configure actions/setup-node with the npm registry URL",
);
assertMatch(
  /^on:\s*[\s\S]*?^\s*push:\s*[\s\S]*?^\s*branches:\s*[\s\S]*?^\s*-\s*main\s*$/m,
  publishWorkflow,
  "publish workflow must run on pushes to main",
);
assertMatch(
  /^on:\s*[\s\S]*?^\s*workflow_dispatch:\s*$/m,
  publishWorkflow,
  "publish workflow must support manual reruns with workflow_dispatch",
);
assertMatch(
  /gh pr merge\b[\s\S]*--auto[\s\S]*--squash[\s\S]*--delete-branch/m,
  prepareWorkflow,
  "prepare workflow must enable auto-merge for the release PR",
);
assertMatch(
  /^permissions:\s*[\s\S]*?^\s*contents:\s*write\s*$/m,
  prepareWorkflow,
  "prepare workflow must keep contents: write for branch pushes and PR creation",
);
assertMatch(
  /^permissions:\s*[\s\S]*?^\s*pull-requests:\s*write\s*$/m,
  prepareWorkflow,
  "prepare workflow must keep pull-requests: write for release PR creation",
);
assertAbsent(
  /git push origin HEAD:main/m,
  prepareWorkflow,
  "prepare workflow must not push directly to main",
);
assertAbsent(
  /npm publish/m,
  prepareWorkflow,
  "prepare workflow must not publish to npm (publish belongs to the publish workflow)",
);
assertAbsent(
  /id-token:\s*write/m,
  prepareWorkflow,
  "prepare workflow must not request id-token: write (least privilege)",
);
assertAbsent(
  /npm version/m,
  publishWorkflow,
  "publish workflow must not bump versions (version bumps belong to the prepare workflow)",
);

process.stdout.write(
  `verified release provenance contract in ${path.relative(repoRoot, publishWorkflowPath)} and ${path.relative(repoRoot, prepareWorkflowPath)}\n`,
);

function assertMatch(pattern, content, message) {
  if (!pattern.test(content)) {
    throw new Error(message);
  }
}

function assertAbsent(pattern, content, message) {
  if (pattern.test(content)) {
    throw new Error(message);
  }
}
