import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectLanguagePath = path.resolve(repoRoot, "docs/internals/project-language/README.md");
const packageJsonPath = path.resolve(repoRoot, "package.json");
const homebrewFormulaPath = path.resolve(repoRoot, "Formula/maestro.rb");
const cliEntrypointPath = path.resolve(repoRoot, "src/cli/main.ts");

const [projectLanguage, packageJsonRaw, formulaRaw, cliEntrypoint] = await Promise.all([
  readFile(projectLanguagePath, "utf8"),
  readFile(packageJsonPath, "utf8"),
  readFile(homebrewFormulaPath, "utf8"),
  readFile(cliEntrypointPath, "utf8"),
]);

const catchlineMatch = projectLanguage.match(/-\s*Catchline:\s*`([^`]+)`/);
const formulaDescMatch = formulaRaw.match(/^\s*desc\s+"([^"]+)"/m);
const cliCatchlineMatch = cliEntrypoint.match(/const CLI_CATCHLINE = "([^"]+)";/);
const cliDescriptionUsesCatchline = /\.description\(CLI_CATCHLINE\)/.test(cliEntrypoint);

if (!catchlineMatch) {
  throw new Error(
    "Could not resolve the canonical catchline from docs/internals/project-language/README.md",
  );
}

if (!formulaDescMatch) {
  throw new Error("Could not resolve Homebrew formula description from Formula/maestro.rb");
}

if (!cliCatchlineMatch) {
  throw new Error("Could not resolve CLI catchline from src/cli/main.ts");
}

if (!cliDescriptionUsesCatchline) {
  throw new Error("CLI root description must use CLI_CATCHLINE in src/cli/main.ts");
}

const packageJson = JSON.parse(packageJsonRaw);
const canonicalCatchline = normalizeCopy(catchlineMatch[1]);
const packageDescription = normalizeCopy(String(packageJson.description ?? ""));
const formulaDescription = normalizeCopy(formulaDescMatch[1]);
const cliCatchline = normalizeCopy(cliCatchlineMatch[1]);

const mismatches = [
  createMismatch({
    source: "package.json description",
    expected: canonicalCatchline,
    actual: packageDescription,
  }),
  createMismatch({
    source: "Formula/maestro.rb desc",
    expected: canonicalCatchline,
    actual: formulaDescription,
  }),
  createMismatch({
    source: "src/cli/main.ts CLI_CATCHLINE",
    expected: canonicalCatchline,
    actual: cliCatchline,
  }),
].filter(Boolean);

if (mismatches.length > 0) {
  throw new Error(
    `distribution copy is out of sync with the canonical catchline:\n${mismatches.join("\n")}`,
  );
}

process.stdout.write(
  "verified distribution copy alignment: project language catchline, npm description, Homebrew formula, and CLI root help are synchronized\n",
);

function normalizeCopy(value) {
  return value.trim().replace(/[.]+$/u, "");
}

function createMismatch({ source, expected, actual }) {
  if (expected === actual) {
    return null;
  }

  return `- ${source}: expected "${expected}", got "${actual}"`;
}
