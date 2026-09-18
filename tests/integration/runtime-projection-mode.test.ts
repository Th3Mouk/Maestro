import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { describe, expect, test } from "vitest";
import { installWorkspace } from "../../src/core/commands.js";
import { pathExists, readText } from "../../src/utils/fs.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

const freshPlannerAgent = [
  "---",
  "name: planner",
  "description: Fresh planner projected by Maestro.",
  "---",
  "",
  "# Planner",
].join("\n");

const freshRunbookSkill = [
  "---",
  "name: local-runbook",
  "description: Fresh runbook projected by Maestro.",
  "---",
].join("\n");

async function createProjectionModeScenario(runtimeLines: string[]): Promise<string> {
  const workspaceRoot = await createManagedTempDir("maestro-projection-mode-");

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
      ...runtimeLines,
      "  repositories: []",
    ].join("\n"),
    "utf8",
  );

  await mkdir(path.join(workspaceRoot, "agents", "standard"), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, "agents", "standard", "planner.md"),
    freshPlannerAgent,
    "utf8",
  );

  await mkdir(path.join(workspaceRoot, "agents", "claude-code"), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, "agents", "claude-code", "planner.md"),
    freshPlannerAgent,
    "utf8",
  );

  await mkdir(path.join(workspaceRoot, "skills", "local-runbook"), { recursive: true });
  await writeFile(
    path.join(workspaceRoot, "skills", "local-runbook", "SKILL.md"),
    freshRunbookSkill,
    "utf8",
  );

  // Pre-seed .claude/ and .agents/ as if a previous, non-Maestro-managed setup already
  // lived there: a hand-written agent/skill Maestro has never heard of, plus a stale
  // "planner" agent and a stale extra file inside "local-runbook" that predate this install.
  for (const targetsRoot of [
    path.join(workspaceRoot, ".claude"),
    path.join(workspaceRoot, ".agents"),
  ]) {
    await mkdir(path.join(targetsRoot, "agents"), { recursive: true });
    await writeFile(
      path.join(targetsRoot, "agents", "planner.md"),
      "stale content that predates this install",
      "utf8",
    );
    await writeFile(
      path.join(targetsRoot, "agents", "hand-written.md"),
      "a hand-written agent unrelated to Maestro",
      "utf8",
    );

    await mkdir(path.join(targetsRoot, "skills", "local-runbook"), { recursive: true });
    await writeFile(
      path.join(targetsRoot, "skills", "local-runbook", "STALE.md"),
      "a stale file inside a skill Maestro is about to re-project",
      "utf8",
    );
    await mkdir(path.join(targetsRoot, "skills", "hand-written-skill"), { recursive: true });
    await writeFile(
      path.join(targetsRoot, "skills", "hand-written-skill", "SKILL.md"),
      "a hand-written skill unrelated to Maestro",
      "utf8",
    );
  }

  await execa("git", ["init", "--initial-branch=main"], { cwd: workspaceRoot });
  await execa("git", ["config", "user.name", "Test User"], { cwd: workspaceRoot });
  await execa("git", ["config", "user.email", "test@example.invalid"], { cwd: workspaceRoot });

  return workspaceRoot;
}

describe("runtime projection mode", () => {
  test("defaults to merge: overwrites same-named entries but keeps hand-placed cohabitants", async () => {
    const workspaceRoot = await createProjectionModeScenario([
      "    standard:",
      "      enabled: true",
      "    claude-code:",
      "      enabled: true",
    ]);

    await installWorkspace(workspaceRoot);

    for (const targetsRoot of [
      path.join(workspaceRoot, ".claude"),
      path.join(workspaceRoot, ".agents"),
    ]) {
      const plannerContent = await readText(path.join(targetsRoot, "agents", "planner.md"));
      expect(plannerContent).toBe(freshPlannerAgent);

      expect(await pathExists(path.join(targetsRoot, "agents", "hand-written.md"))).toBe(true);

      const skillContent = await readText(
        path.join(targetsRoot, "skills", "local-runbook", "SKILL.md"),
      );
      expect(skillContent).toBe(freshRunbookSkill);
      expect(await pathExists(path.join(targetsRoot, "skills", "local-runbook", "STALE.md"))).toBe(
        false,
      );

      expect(
        await pathExists(path.join(targetsRoot, "skills", "hand-written-skill", "SKILL.md")),
      ).toBe(true);
    }
  });

  test("replace wipes the whole target directory, dropping anything Maestro doesn't own", async () => {
    const workspaceRoot = await createProjectionModeScenario([
      "    standard:",
      "      enabled: true",
      "      projectionMode: replace",
      "    claude-code:",
      "      enabled: true",
      "      projectionMode: replace",
    ]);

    await installWorkspace(workspaceRoot);

    for (const targetsRoot of [
      path.join(workspaceRoot, ".claude"),
      path.join(workspaceRoot, ".agents"),
    ]) {
      const plannerContent = await readText(path.join(targetsRoot, "agents", "planner.md"));
      expect(plannerContent).toBe(freshPlannerAgent);
      expect(await pathExists(path.join(targetsRoot, "agents", "hand-written.md"))).toBe(false);

      const skillContent = await readText(
        path.join(targetsRoot, "skills", "local-runbook", "SKILL.md"),
      );
      expect(skillContent).toBe(freshRunbookSkill);
      expect(await pathExists(path.join(targetsRoot, "skills", "local-runbook", "STALE.md"))).toBe(
        false,
      );
      expect(await pathExists(path.join(targetsRoot, "skills", "hand-written-skill"))).toBe(false);
    }
  });
});
