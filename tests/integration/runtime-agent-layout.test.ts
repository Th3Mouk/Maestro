import { lstat, mkdir, readFile, readlink, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { describe, expect, test } from "vitest";
import { installWorkspace } from "../../src/core/commands.js";
import { pathExists } from "../../src/utils/fs.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

async function createRuntimeProjectionScenario(): Promise<string> {
  const workspaceRoot = await createManagedTempDir("maestro-runtime-projection-");

  await writeFile(
    path.join(workspaceRoot, "maestro.yaml"),
    [
      "apiVersion: maestro/v1",
      "kind: Workspace",
      "metadata:",
      "  name: test-workspace",
      "spec:",
      "  agents:",
      "    standard:",
      "      - planner",
      "    claude-code:",
      "      - planner",
      "  skills:",
      "    - local-runbook",
      "  runtimes:",
      "    standard:",
      "      enabled: true",
      "      agents: {}",
      "    claude-code:",
      "      enabled: true",
      "      agents: {}",
      "  repositories: []",
    ].join("\n"),
    "utf8",
  );

  await mkdir(path.join(workspaceRoot, "agents", "standard"), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, "agents", "standard", "planner.md"),
    [
      "---",
      "name: planner",
      "description: Plan workspace changes before implementation.",
      "---",
      "",
      "# Planner",
      "",
      "Plan workspace changes before implementation.",
    ].join("\n"),
    "utf8",
  );

  await mkdir(path.join(workspaceRoot, "agents", "claude-code"), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, "agents", "claude-code", "planner.md"),
    [
      "---",
      "name: planner",
      "description: Plan workspace changes before implementation.",
      "---",
      "",
      "# Planner",
      "",
      "Plan workspace changes before implementation.",
      "",
      "- Break the work into bounded steps.",
      "- State dependencies and success criteria.",
      "- Keep the plan short and actionable.",
    ].join("\n"),
    "utf8",
  );

  await mkdir(path.join(workspaceRoot, "skills", "local-runbook"), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, "skills", "local-runbook", "SKILL.md"),
    ["---", "name: local-runbook", "description: Local runbook skill.", "---"].join("\n"),
    "utf8",
  );

  await execa("git", ["init", "--initial-branch=main"], { cwd: workspaceRoot });
  await execa("git", ["config", "user.name", "Test User"], { cwd: workspaceRoot });
  await execa("git", ["config", "user.email", "test@example.invalid"], { cwd: workspaceRoot });

  return workspaceRoot;
}

describe("runtime agent layout projection", () => {
  test("projects the standard agent into .agents/agents/", async () => {
    const workspaceRoot = await createRuntimeProjectionScenario();
    await installWorkspace(workspaceRoot);

    const content = await readFile(
      path.join(workspaceRoot, ".agents", "agents", "planner.md"),
      "utf8",
    );

    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("name: planner");
    expect(content).toContain("description:");
    expect(content).toContain("# Planner");
    expect(content).not.toContain("docs/internals/");
  });

  test("projects claude-code agent with correct markdown frontmatter and body", async () => {
    const workspaceRoot = await createRuntimeProjectionScenario();
    await installWorkspace(workspaceRoot);

    const content = await readFile(
      path.join(workspaceRoot, ".claude", "agents", "planner.md"),
      "utf8",
    );

    expect(content.startsWith("---\n")).toBe(true);
    expect(content).toContain("name: planner");
    expect(content).toContain("description:");
    expect(content).toContain("# Planner");
    expect(content).not.toContain("docs/internals/");
  });

  test("projects the shared .agents/skills/ standard without touching .agents/plugins/", async () => {
    const workspaceRoot = await createRuntimeProjectionScenario();

    await mkdir(path.join(workspaceRoot, ".agents", "plugins"), { recursive: true });
    await writeFile(
      path.join(workspaceRoot, ".agents", "plugins", "marketplace.json"),
      JSON.stringify({ plugins: [] }),
      "utf8",
    );

    await installWorkspace(workspaceRoot);

    const skillContent = await readFile(
      path.join(workspaceRoot, ".agents", "skills", "local-runbook", "SKILL.md"),
      "utf8",
    );
    expect(skillContent).toContain("name: local-runbook");

    const marketplaceStat = await stat(
      path.join(workspaceRoot, ".agents", "plugins", "marketplace.json"),
    );
    expect(marketplaceStat.isFile()).toBe(true);
  });

  test("projects claude-code skills without writing CLAUDE.md, settings, or commands", async () => {
    const workspaceRoot = await createRuntimeProjectionScenario();
    await installWorkspace(workspaceRoot);

    expect(await pathExists(path.join(workspaceRoot, "CLAUDE.md"))).toBe(false);
    expect(await pathExists(path.join(workspaceRoot, ".claude", "settings.json"))).toBe(false);
    expect(await pathExists(path.join(workspaceRoot, ".claude", "commands"))).toBe(false);
    expect(await pathExists(path.join(workspaceRoot, ".mcp.json"))).toBe(false);

    const claudeSkillRoot = path.join(workspaceRoot, ".claude", "skills", "local-runbook");
    expect((await lstat(claudeSkillRoot)).isSymbolicLink()).toBe(true);
    expect(await readlink(claudeSkillRoot)).toBe(
      path.join("..", "..", ".agents", "skills", "local-runbook"),
    );
    const claudeSkill = await readFile(path.join(claudeSkillRoot, "SKILL.md"), "utf8");
    expect(claudeSkill).toContain("name: local-runbook");
  });

  test("keeps a team-owned CLAUDE.md untouched", async () => {
    const workspaceRoot = await createRuntimeProjectionScenario();
    await writeFile(path.join(workspaceRoot, "CLAUDE.md"), "@AGENTS.md\n", "utf8");

    await installWorkspace(workspaceRoot);

    expect(await readFile(path.join(workspaceRoot, "CLAUDE.md"), "utf8")).toBe("@AGENTS.md\n");
  });
});
