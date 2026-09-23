import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { resolveWorkspace } from "../../src/core/workspace-service.js";
import { getFrameworkVersion } from "../../src/version.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";
import { writeYaml } from "../utils/yaml.js";

describe("workspace resolution", () => {
  test("auto-loads default workspace fragments from the fragments directory", async () => {
    const root = await createManagedTempDir("workspace-resolution-");
    await mkdir(path.join(root, "fragments"), { recursive: true });
    await writeYaml(path.join(root, "maestro.yaml"), {
      apiVersion: "maestro/v1",
      kind: "Workspace",
      metadata: { name: "auto-fragments" },
      spec: {
        runtimes: {
          standard: { enabled: true },
        },
        repositories: [],
      },
    });
    await writeYaml(path.join(root, "fragments", "repositories.yaml"), {
      apiVersion: "maestro/v1",
      kind: "WorkspaceFragment",
      metadata: { name: "repositories" },
      spec: {
        repositories: [
          {
            name: "sur-api",
            remote: "git@github.com:org/sur-api.git",
            branch: "main",
            sparse: { visiblePaths: [".github/"] },
          },
        ],
      },
    });

    const resolved = await resolveWorkspace(root);
    expect(resolved.repositories).toHaveLength(1);
    expect(resolved.repositories[0]?.name).toBe("sur-api");
    expect(resolved.runtimes.standard?.skills).toEqual({ mode: "merge", strategy: "copy" });
  });

  test("does not inject implicit packs when none are declared", async () => {
    const root = await createManagedTempDir("workspace-no-default-pack-");
    await writeYaml(path.join(root, "maestro.yaml"), {
      apiVersion: "maestro/v1",
      kind: "Workspace",
      metadata: { name: "no-default-pack" },
      spec: {
        runtimes: {
          standard: { enabled: true },
        },
        repositories: [],
      },
    });

    const resolved = await resolveWorkspace(root);
    expect(resolved.selectedAgents.standard).toEqual([]);
    expect(resolved.selectedSkills).toEqual([]);
  });

  test("resolves pack-provided agents and skills only when declared explicitly", async () => {
    const root = await createManagedTempDir("workspace-explicit-pack-");
    await mkdir(path.join(root, "packs", "pack-core", "agents", "standard"), { recursive: true });
    await mkdir(path.join(root, "packs", "pack-core", "skills", "gha-normalizer"), {
      recursive: true,
    });

    await writeYaml(path.join(root, "packs", "pack-core", "pack.yaml"), {
      apiVersion: "maestro/v1",
      kind: "Pack",
      metadata: {
        name: "@maestro/pack-core",
        version: "1.0.0",
      },
      spec: {
        provides: {
          agents: {
            standard: ["planner"],
          },
          skills: ["gha-normalizer"],
        },
      },
    });

    await writeFile(
      path.join(root, "packs", "pack-core", "agents", "standard", "planner.md"),
      ["# planner", "", "Plan workspace maintenance."].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(root, "packs", "pack-core", "skills", "gha-normalizer", "SKILL.md"),
      ["# gha-normalizer", "", "Normalizes GitHub Actions workflows."].join("\n"),
      "utf8",
    );
    await writeYaml(path.join(root, "maestro.yaml"), {
      apiVersion: "maestro/v1",
      kind: "Workspace",
      metadata: { name: "explicit-pack" },
      spec: {
        runtimes: {
          standard: { enabled: true },
        },
        agents: {
          standard: ["planner"],
        },
        skills: ["gha-normalizer"],
        packs: [
          {
            name: "@maestro/pack-core",
            source: "./packs/pack-core",
          },
        ],
        repositories: [
          {
            name: "sur-api",
            remote: "git@github.com:org/sur-api.git",
            branch: "main",
            sparse: { visiblePaths: [".github/"] },
          },
        ],
      },
    });

    const resolved = await resolveWorkspace(root);
    expect(resolved.selectedAgents.standard.map((agent) => agent.name)).toEqual(["planner"]);
    expect(resolved.selectedSkills.map((skill) => skill.name)).toEqual(["gha-normalizer"]);
    expect(resolved.selectedSkills[0]?.source).toBe("pack");
  });

  test("defaults repository branches to main when omitted from the manifest", async () => {
    const root = await createManagedTempDir("workspace-default-branch-");
    await writeYaml(path.join(root, "maestro.yaml"), {
      apiVersion: "maestro/v1",
      kind: "Workspace",
      metadata: { name: "default-branch" },
      spec: {
        runtimes: {
          codex: { enabled: true },
        },
        repositories: [
          {
            name: "sur-api",
            remote: "git@github.com:org/sur-api.git",
            sparse: { visiblePaths: [".github/"] },
          },
        ],
      },
    });

    const resolved = await resolveWorkspace(root);
    expect(resolved.lockfile.repositories[0]?.branch).toBe("main");
  });

  test("ignores a legacy spec.mcpServers declaration instead of projecting it", async () => {
    const root = await createManagedTempDir("workspace-legacy-mcp-");
    await writeYaml(path.join(root, "maestro.yaml"), {
      apiVersion: "maestro/v1",
      kind: "Workspace",
      metadata: { name: "mcp" },
      spec: {
        runtimes: {
          "claude-code": { enabled: true },
        },
        repositories: [],
        mcpServers: [{ name: "context7", transport: "stdio", command: "npx" }],
      },
    });

    const resolved = await resolveWorkspace(root);
    expect(resolved.manifest.spec).not.toHaveProperty("mcpServers");
    expect(resolved).not.toHaveProperty("mcpServers");
  });

  test("fails when a requested skill cannot be resolved", async () => {
    const root = await createManagedTempDir("workspace-missing-skill-");
    await writeYaml(path.join(root, "maestro.yaml"), {
      apiVersion: "maestro/v1",
      kind: "Workspace",
      metadata: { name: "missing-skill" },
      spec: {
        runtimes: {
          codex: { enabled: true },
        },
        repositories: [
          {
            name: "sur-api",
            remote: "git@github.com:org/sur-api.git",
            branch: "main",
            sparse: { visiblePaths: [".github/"] },
          },
        ],
        skills: ["custom-skill"],
      },
    });

    await expect(resolveWorkspace(root)).rejects.toThrow("Skill not found: custom-skill");
  });

  test("keeps plugin activation in the resolved workspace", async () => {
    const root = await createManagedTempDir("workspace-plugins-");
    await writeYaml(path.join(root, "maestro.yaml"), {
      apiVersion: "maestro/v1",
      kind: "Workspace",
      metadata: { name: "plugins" },
      spec: {
        runtimes: {
          standard: { enabled: true },
          "claude-code": { enabled: true },
        },
        repositories: [
          {
            name: "sur-api",
            remote: "git@github.com:org/sur-api.git",
            branch: "main",
            sparse: { visiblePaths: [".github/"] },
          },
        ],
        plugins: {
          "claude-code": {
            enabled: {
              "release-helper@ops-workspace": true,
            },
            marketplaces: {
              "ops-workspace": {
                source: {
                  source: "directory",
                  path: "./plugins",
                },
              },
            },
          },
        },
      },
    });

    const resolved = await resolveWorkspace(root);
    expect(resolved.manifest.spec.plugins?.["claude-code"]?.marketplaces).toEqual({
      "ops-workspace": {
        source: {
          source: "directory",
          path: "./plugins",
        },
      },
    });
  });

  test("fails when a pack compatibility range rejects the framework version", async () => {
    const root = await createManagedTempDir("workspace-incompatible-pack-");
    const packRoot = path.join(root, "packs", "pack-legacy");
    await mkdir(packRoot, { recursive: true });
    await cp(
      path.join(process.cwd(), "tests", "fixtures", "invalid", "pack-version-mismatch.yaml"),
      path.join(packRoot, "pack.yaml"),
    );
    await writeYaml(path.join(root, "maestro.yaml"), {
      apiVersion: "maestro/v1",
      kind: "Workspace",
      metadata: { name: "incompatible-pack" },
      spec: {
        runtimes: {
          codex: { enabled: true },
        },
        repositories: [
          {
            name: "sur-api",
            remote: "git@github.com:org/sur-api.git",
            branch: "main",
            sparse: { visiblePaths: [".github/"] },
          },
        ],
        packs: [
          {
            name: "@maestro/pack-legacy",
            source: "./packs/pack-legacy",
          },
        ],
      },
    });

    await expect(resolveWorkspace(root)).rejects.toThrow(
      `is incompatible with framework ${getFrameworkVersion()}`,
    );
  });
});
