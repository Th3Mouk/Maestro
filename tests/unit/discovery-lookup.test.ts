import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { listAgentNames, listSkillNames } from "../../src/workspace/discovery/lookup.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

describe("listAgentNames", () => {
  test("lists agent file names and ignores files with an unsupported extension", async () => {
    const root = await createManagedTempDir("discovery-lookup-agents-");
    await mkdir(root, { recursive: true });
    await writeFile(path.join(root, "planner.md"), "# planner\n");
    await writeFile(path.join(root, "reviewer.toml"), 'name = "reviewer"\n');
    await writeFile(path.join(root, "README.txt"), "not an agent file\n");

    expect(await listAgentNames(root)).toEqual(["planner", "reviewer"]);
  });

  test("returns an empty list when the directory does not exist", async () => {
    const root = await createManagedTempDir("discovery-lookup-agents-missing-");
    expect(await listAgentNames(path.join(root, "does-not-exist"))).toEqual([]);
  });
});

describe("listSkillNames", () => {
  test("lists skill directory names and ignores directories without a SKILL.md", async () => {
    const root = await createManagedTempDir("discovery-lookup-skills-");
    await mkdir(path.join(root, "local-runbook"), { recursive: true });
    await writeFile(path.join(root, "local-runbook", "SKILL.md"), "# local runbook\n");
    await mkdir(path.join(root, "scratch-notes"), { recursive: true });
    await writeFile(path.join(root, "scratch-notes", "README.md"), "not a skill\n");

    expect(await listSkillNames(root)).toEqual(["local-runbook"]);
  });
});
