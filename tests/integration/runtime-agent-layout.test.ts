import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("runtime agent layout", () => {
  test("keeps Claude project agents as symlinks to the canonical role files", async () => {
    const plannerLink = path.join(process.cwd(), ".claude", "agents", "planner.md");
    const stats = await lstat(plannerLink);

    expect(stats.isSymbolicLink()).toBe(true);
  });

  test("keeps Codex project agents self-contained and native", async () => {
    const slotAgents = [
      ["default", "Triage broad repository work and route it into planner-first orchestration."],
      ["worker", "Execute bounded repository changes and keep the diff small."],
      ["explorer", "Read the repository, gather evidence, and avoid making changes."],
    ] as const;

    for (const [name, summary] of slotAgents) {
      const content = await readFile(
        path.join(process.cwd(), ".codex", "agents", `${name}.toml`),
        "utf8",
      );

      expect(content).toContain(`name = "${name}"`);
      expect(content).toContain('developer_instructions = """');
      expect(content).toContain(summary);
      expect(content).toContain("Repository rules:");
      expect(content).toContain("[[skills.config]]");
      expect(content).toContain(path.join(process.cwd(), ".codex", "skills", "v1"));
      expect(content).not.toContain("Role contract:");
      expect(content).not.toContain("docs/internals/");
    }
  });
});
