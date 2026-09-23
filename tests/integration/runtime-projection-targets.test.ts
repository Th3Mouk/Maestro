import { lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { describe, expect, test } from "vitest";
import YAML from "yaml";
import { doctorWorkspace, initWorkspace, installWorkspace } from "../../src/core/commands.js";
import { pathExists } from "../../src/utils/fs.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

const markdownAgent = (name: string) =>
  ["---", `name: ${name}`, `description: ${name} agent.`, "---", "", `# ${name}`, ""].join("\n");

const workflowScript = (name: string) =>
  [`export const meta = { name: "${name}", description: "${name} workflow." };`, ""].join("\n");

async function writeWorkspaceFile(root: string, relativePath: string, content: string) {
  await mkdir(path.dirname(path.join(root, relativePath)), { recursive: true });
  await writeFile(path.join(root, relativePath), content, "utf8");
}

async function createWorkspace(specLines: string[]): Promise<string> {
  const workspaceRoot = await createManagedTempDir("maestro-projection-targets-");
  await writeWorkspaceFile(
    workspaceRoot,
    "maestro.yaml",
    [
      "apiVersion: maestro/v1",
      "kind: Workspace",
      "metadata:",
      "  name: projection-targets",
      "spec:",
      ...specLines,
      "  repositories: []",
    ].join("\n"),
  );
  await writeWorkspaceFile(
    workspaceRoot,
    "skills/runbook/SKILL.md",
    ["---", "name: runbook", "description: Runbook skill.", "---", ""].join("\n"),
  );
  await writeWorkspaceFile(workspaceRoot, "workflows/triage.js", workflowScript("triage"));

  await execa("git", ["init", "--initial-branch=main"], { cwd: workspaceRoot });
  await execa("git", ["config", "user.name", "Test User"], { cwd: workspaceRoot });
  await execa("git", ["config", "user.email", "test@example.invalid"], { cwd: workspaceRoot });
  return workspaceRoot;
}

describe("runtime projection targets", () => {
  test("applies the canonical layout when spec.runtimes is omitted", async () => {
    const workspaceRoot = await createWorkspace([]);
    await writeWorkspaceFile(
      workspaceRoot,
      "agents/claude-code/planner.md",
      markdownAgent("planner"),
    );

    await installWorkspace(workspaceRoot);

    expect(await pathExists(path.join(workspaceRoot, ".agents/skills/runbook/SKILL.md"))).toBe(
      true,
    );
    expect(await pathExists(path.join(workspaceRoot, ".claude/skills/runbook/SKILL.md"))).toBe(
      true,
    );
    expect(await readFile(path.join(workspaceRoot, ".claude/workflows/triage.js"), "utf8")).toBe(
      workflowScript("triage"),
    );
    // Agent projection stays off until a runtime defines `agents`.
    expect(await pathExists(path.join(workspaceRoot, ".claude/agents"))).toBe(false);
    expect(await pathExists(path.join(workspaceRoot, "CLAUDE.md"))).toBe(false);
    expect(await readFile(path.join(workspaceRoot, ".gitignore"), "utf8")).toBe(
      [
        "repos/",
        ".maestro/",
        ".agents/skills/",
        ".claude/skills/",
        ".claude/workflows/",
        "node_modules/",
        ".devcontainer/",
        "",
      ].join("\n"),
    );
  });

  test("projects each runtime's agents into its native directory and file name", async () => {
    const workspaceRoot = await createWorkspace([
      "  runtimes:",
      "    codex:",
      "      agents: {}",
      "    copilot:",
      "      agents: {}",
      "    cursor:",
      "      agents: {}",
      "    gemini:",
      "      agents: true",
      "    opencode:",
      "      agents: {}",
      "    kilo:",
      "      agents: {}",
      "    devin:",
      "      agents: {}",
    ]);
    await writeWorkspaceFile(
      workspaceRoot,
      "agents/codex/reviewer.toml",
      'name = "reviewer"\ndescription = "Reviewer."\ndeveloper_instructions = "Review."\n',
    );
    await writeWorkspaceFile(
      workspaceRoot,
      "agents/copilot/reviewer.md",
      markdownAgent("reviewer"),
    );
    await writeWorkspaceFile(
      workspaceRoot,
      "agents/copilot/planner.agent.md",
      markdownAgent("planner"),
    );
    for (const runtime of ["cursor", "gemini", "opencode", "kilo", "devin"]) {
      await writeWorkspaceFile(
        workspaceRoot,
        `agents/${runtime}/reviewer.md`,
        markdownAgent("reviewer"),
      );
    }

    await installWorkspace(workspaceRoot);

    expect(
      await readFile(path.join(workspaceRoot, ".codex/agents/reviewer.toml"), "utf8"),
    ).toContain("developer_instructions");
    expect(await pathExists(path.join(workspaceRoot, ".github/agents/reviewer.agent.md"))).toBe(
      true,
    );
    expect(await pathExists(path.join(workspaceRoot, ".github/agents/planner.agent.md"))).toBe(
      true,
    );
    for (const dir of [".cursor", ".gemini", ".opencode", ".kilo", ".devin"]) {
      expect(await pathExists(path.join(workspaceRoot, dir, "agents", "reviewer.md"))).toBe(true);
    }
    // Explicit runtimes replace the canonical layout, so no skills or workflows are projected.
    expect(await pathExists(path.join(workspaceRoot, ".agents/skills"))).toBe(false);
    expect(await pathExists(path.join(workspaceRoot, ".claude"))).toBe(false);

    const gitignore = await readFile(path.join(workspaceRoot, ".gitignore"), "utf8");
    expect(gitignore).toContain(".codex/agents/\n");
    expect(gitignore).toContain(".github/agents/\n");
    expect(gitignore).not.toContain(".claude/");
  });

  test("writes a valid placeholder for a selected agent no file defines", async () => {
    const workspaceRoot = await createWorkspace([
      "  runtimes:",
      "    codex:",
      "      agents: {}",
      "    claude-code:",
      "      agents: {}",
      "  agents:",
      "    codex: [ghost]",
      "    claude-code: [ghost]",
    ]);

    await installWorkspace(workspaceRoot);

    expect(await readFile(path.join(workspaceRoot, ".codex/agents/ghost.toml"), "utf8")).toBe(
      [
        'name = "ghost"',
        'description = "Generated agent for Codex."',
        'developer_instructions = "Generated agent for Codex."',
        "",
      ].join("\n"),
    );
    expect(await readFile(path.join(workspaceRoot, ".claude/agents/ghost.md"), "utf8")).toContain(
      "name: ghost\ndescription: Generated agent for Claude Code.\n",
    );
  });

  test("merges workflows by default and replaces the directory on request", async () => {
    const mergeRoot = await createWorkspace(["  runtimes:", "    claude-code: {}"]);
    await writeWorkspaceFile(mergeRoot, ".claude/workflows/hand-saved.js", workflowScript("saved"));
    await writeWorkspaceFile(mergeRoot, ".claude/workflows/triage.js", "stale");

    await installWorkspace(mergeRoot);

    expect(await readFile(path.join(mergeRoot, ".claude/workflows/triage.js"), "utf8")).toBe(
      workflowScript("triage"),
    );
    expect(await pathExists(path.join(mergeRoot, ".claude/workflows/hand-saved.js"))).toBe(true);

    const replaceRoot = await createWorkspace([
      "  runtimes:",
      "    claude-code:",
      "      workflows:",
      "        mode: replace",
    ]);
    await writeWorkspaceFile(
      replaceRoot,
      ".claude/workflows/hand-saved.js",
      workflowScript("saved"),
    );

    await installWorkspace(replaceRoot);

    expect(await pathExists(path.join(replaceRoot, ".claude/workflows/triage.js"))).toBe(true);
    expect(await pathExists(path.join(replaceRoot, ".claude/workflows/hand-saved.js"))).toBe(false);
  });

  test("skips workflow and skill projection when disabled", async () => {
    const workspaceRoot = await createWorkspace([
      "  runtimes:",
      "    claude-code:",
      "      skills: false",
      "      workflows: false",
    ]);

    await installWorkspace(workspaceRoot);

    expect(await pathExists(path.join(workspaceRoot, ".claude/workflows"))).toBe(false);
    expect(await pathExists(path.join(workspaceRoot, ".claude/skills"))).toBe(false);
  });

  test("fails when a selected workflow cannot be resolved", async () => {
    const workspaceRoot = await createWorkspace(["  workflows: [missing]"]);

    await expect(installWorkspace(workspaceRoot)).rejects.toThrow("Workflow not found: missing");
  });

  test("copies claude-code skills when the standard runtime does not project them", async () => {
    const onlyClaude = await createWorkspace(["  runtimes:", "    claude-code: {}"]);
    await installWorkspace(onlyClaude);
    const onlyClaudeSkill = path.join(onlyClaude, ".claude/skills/runbook");
    expect((await lstat(onlyClaudeSkill)).isDirectory()).toBe(true);

    const explicitCopy = await createWorkspace([
      "  runtimes:",
      "    standard: {}",
      "    claude-code:",
      "      skills:",
      "        strategy: copy",
    ]);
    await installWorkspace(explicitCopy);
    const copiedSkill = path.join(explicitCopy, ".claude/skills/runbook");
    expect((await lstat(copiedSkill)).isDirectory()).toBe(true);
    expect((await lstat(copiedSkill)).isSymbolicLink()).toBe(false);
  });

  test("merges plugin settings into a team-owned .claude/settings.json", async () => {
    const workspaceRoot = await createWorkspace([
      "  runtimes:",
      "    claude-code: {}",
      "  plugins:",
      "    claude-code:",
      "      enabled:",
      '        "release-helper@ops": true',
    ]);
    await writeWorkspaceFile(
      workspaceRoot,
      ".claude/settings.json",
      JSON.stringify({
        generated: true,
        workspace: "projection-targets",
        hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] },
        permissions: { allow: ["Bash(pnpm test)"] },
      }),
    );

    await installWorkspace(workspaceRoot);

    expect(
      JSON.parse(await readFile(path.join(workspaceRoot, ".claude/settings.json"), "utf8")),
    ).toEqual({
      enabledPlugins: { "release-helper@ops": true },
      hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] },
      permissions: { allow: ["Bash(pnpm test)"] },
    });
  });

  test("doctor flags a CLAUDE.md generated by an earlier Maestro version", async () => {
    const workspaceRoot = await createWorkspace([]);
    await installWorkspace(workspaceRoot);
    await writeWorkspaceFile(
      workspaceRoot,
      "CLAUDE.md",
      "<!-- Generated by Maestro. Local overrides may exist in overrides/. -->\n\n# ws\n",
    );

    const legacyReport = await doctorWorkspace(workspaceRoot);
    expect(legacyReport.issues.map((issue) => issue.code)).toContain("LEGACY_GENERATED_CLAUDE_MD");

    await writeWorkspaceFile(workspaceRoot, "CLAUDE.md", "@AGENTS.md\n");
    const ownedReport = await doctorWorkspace(workspaceRoot);
    expect(ownedReport.issues.map((issue) => issue.code)).not.toContain(
      "LEGACY_GENERATED_CLAUDE_MD",
    );
  });

  test("resolves pack-provided and overridden workflows", async () => {
    const workspaceRoot = await createWorkspace([
      "  packs:",
      '    - name: "@org/pack-flows"',
      "      version: ^1.0.0",
      "      source: ./packs/pack-flows",
      "  workflows: [release, triage]",
    ]);
    await writeWorkspaceFile(
      workspaceRoot,
      "packs/pack-flows/pack.yaml",
      [
        "apiVersion: maestro/v1",
        "kind: Pack",
        "metadata:",
        '  name: "@org/pack-flows"',
        "  version: 1.0.0",
        "spec:",
        "  provides:",
        "    workflows: [release]",
      ].join("\n"),
    );
    await writeWorkspaceFile(
      workspaceRoot,
      "packs/pack-flows/workflows/release.js",
      workflowScript("release"),
    );
    await writeWorkspaceFile(
      workspaceRoot,
      "overrides/workflows/triage.js",
      workflowScript("override"),
    );

    await installWorkspace(workspaceRoot);

    expect(await readFile(path.join(workspaceRoot, ".claude/workflows/release.js"), "utf8")).toBe(
      workflowScript("release"),
    );
    expect(await readFile(path.join(workspaceRoot, ".claude/workflows/triage.js"), "utf8")).toBe(
      workflowScript("override"),
    );
  });

  test("init scaffolds agent projection for agent-only runtimes and never writes CLAUDE.md", async () => {
    const parent = await createManagedTempDir("maestro-init-runtimes-");
    const workspaceRoot = path.join(parent, "ws");

    await initWorkspace(workspaceRoot, { runtimeNames: ["claude-code", "codex"] });

    const manifest = YAML.parse(await readFile(path.join(workspaceRoot, "maestro.yaml"), "utf8"));
    expect(manifest.spec.runtimes).toEqual({
      "claude-code": { enabled: true },
      codex: { enabled: true, agents: { mode: "merge" } },
    });
    expect(await pathExists(path.join(workspaceRoot, "AGENTS.md"))).toBe(true);
    expect(await pathExists(path.join(workspaceRoot, "CLAUDE.md"))).toBe(false);
    expect(await readFile(path.join(workspaceRoot, ".gitignore"), "utf8")).toBe(
      [
        "repos/",
        ".maestro/",
        ".claude/skills/",
        ".claude/workflows/",
        ".codex/agents/",
        "node_modules/",
        ".devcontainer/",
        "",
      ].join("\n"),
    );
  });

  test("re-installs over existing skill links in merge and replace modes", async () => {
    for (const standardSkills of ["{}", "{ mode: replace }"]) {
      const workspaceRoot = await createWorkspace([
        "  runtimes:",
        `    standard: { skills: ${standardSkills} }`,
        "    claude-code: {}",
      ]);

      await installWorkspace(workspaceRoot);
      await installWorkspace(workspaceRoot);

      const linkedSkill = path.join(workspaceRoot, ".claude/skills/runbook");
      expect((await lstat(linkedSkill)).isSymbolicLink()).toBe(true);
      expect(await pathExists(path.join(linkedSkill, "SKILL.md"))).toBe(true);
    }
  });

  test("replaces a dangling skill link with a copy once standard skills are gone", async () => {
    const workspaceRoot = await createWorkspace([]);
    await installWorkspace(workspaceRoot);
    await rm(path.join(workspaceRoot, ".agents"), { recursive: true, force: true });
    await writeWorkspaceFile(
      workspaceRoot,
      "maestro.yaml",
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: projection-targets",
        "spec:",
        "  runtimes:",
        "    claude-code: {}",
        "  repositories: []",
      ].join("\n"),
    );

    await installWorkspace(workspaceRoot);

    const copiedSkill = path.join(workspaceRoot, ".claude/skills/runbook");
    expect((await lstat(copiedSkill)).isSymbolicLink()).toBe(false);
    expect(await pathExists(path.join(copiedSkill, "SKILL.md"))).toBe(true);
  });

  test("replaces a hand-made .claude/skills directory link without deleting its target", async () => {
    const workspaceRoot = await createWorkspace([]);
    await mkdir(path.join(workspaceRoot, ".agents/skills/hand-written"), { recursive: true });
    await writeFile(path.join(workspaceRoot, ".agents/skills/hand-written/SKILL.md"), "x\n");
    await mkdir(path.join(workspaceRoot, ".claude"), { recursive: true });
    await symlink(path.join("..", ".agents", "skills"), path.join(workspaceRoot, ".claude/skills"));

    await installWorkspace(workspaceRoot);

    expect((await lstat(path.join(workspaceRoot, ".claude/skills"))).isSymbolicLink()).toBe(false);
    expect(await pathExists(path.join(workspaceRoot, ".agents/skills/runbook/SKILL.md"))).toBe(
      true,
    );
    expect(await pathExists(path.join(workspaceRoot, ".agents/skills/hand-written/SKILL.md"))).toBe(
      true,
    );
    expect(await pathExists(path.join(workspaceRoot, ".claude/skills/runbook/SKILL.md"))).toBe(
      true,
    );
  });

  test("layers pack runtime fragments on top of the canonical layout", async () => {
    const workspaceRoot = await createWorkspace([
      "  packs:",
      '    - name: "@org/pack-codex"',
      "      version: ^1.0.0",
      "      source: ./packs/pack-codex",
    ]);
    await writeWorkspaceFile(
      workspaceRoot,
      "packs/pack-codex/pack.yaml",
      [
        "apiVersion: maestro/v1",
        "kind: Pack",
        "metadata:",
        '  name: "@org/pack-codex"',
        "  version: 1.0.0",
        "spec:",
        "  fragments: [runtimes.yaml]",
      ].join("\n"),
    );
    await writeWorkspaceFile(
      workspaceRoot,
      "packs/pack-codex/fragments/runtimes.yaml",
      ["runtimes:", "  codex:", "    agents: {}"].join("\n"),
    );
    await writeWorkspaceFile(
      workspaceRoot,
      "agents/codex/reviewer.toml",
      'name = "reviewer"\ndescription = "Reviewer."\ndeveloper_instructions = "Review."\n',
    );

    await installWorkspace(workspaceRoot);

    expect(await pathExists(path.join(workspaceRoot, ".agents/skills/runbook/SKILL.md"))).toBe(
      true,
    );
    expect(await pathExists(path.join(workspaceRoot, ".claude/workflows/triage.js"))).toBe(true);
    expect(await pathExists(path.join(workspaceRoot, ".codex/agents/reviewer.toml"))).toBe(true);
  });
});
