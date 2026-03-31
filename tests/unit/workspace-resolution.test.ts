import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { resolveWorkspace } from "../../src/core/workspace-service.js";
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
          codex: { enabled: true },
        },
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
    expect(resolved.runtimes.codex?.enabled).toBe(true);
  });

  test("falls back to the built-in starter pack when no workspace overrides exist", async () => {
    const root = await createManagedTempDir("workspace-starter-pack-");
    await writeYaml(path.join(root, "maestro.yaml"), {
      apiVersion: "maestro/v1",
      kind: "Workspace",
      metadata: { name: "starter-pack" },
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
      },
    });

    const resolved = await resolveWorkspace(root);
    expect(resolved.selectedAgents.codex.map((agent) => agent.name)).toEqual(
      expect.arrayContaining(["default", "planner", "executor", "repo-auditor"]),
    );
    expect(resolved.selectedSkills.map((skill) => skill.name)).toContain("gha-normalizer");
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

  test("resolves project-scoped MCP servers from the workspace manifest", async () => {
    const root = await createManagedTempDir("workspace-mcp-");
    await writeYaml(path.join(root, "maestro.yaml"), {
      apiVersion: "maestro/v1",
      kind: "Workspace",
      metadata: { name: "mcp" },
      spec: {
        runtimes: {
          codex: { enabled: true },
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
        mcpServers: [
          {
            name: "context7",
            transport: "stdio",
            command: "npx",
            args: ["-y", "@upstash/context7-mcp"],
          },
          {
            name: "sentry",
            transport: "http",
            url: "https://mcp.sentry.dev/mcp",
          },
        ],
      },
    });

    const resolved = await resolveWorkspace(root);
    expect(resolved.mcpServers.map((server) => server.name)).toEqual(["context7", "sentry"]);
    expect(resolved.mcpServers[0]).toMatchObject({
      transport: "stdio",
      command: "npx",
    });
    expect(resolved.mcpServers[1]).toMatchObject({
      transport: "http",
      url: "https://mcp.sentry.dev/mcp",
    });
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

  test("keeps plugin activation and mcp server declarations in the resolved workspace", async () => {
    const root = await createManagedTempDir("workspace-plugins-and-mcp-");
    await writeYaml(path.join(root, "maestro.yaml"), {
      apiVersion: "maestro/v1",
      kind: "Workspace",
      metadata: { name: "plugins-and-mcp" },
      spec: {
        runtimes: {
          codex: { enabled: true },
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
          codex: {
            enabled: {
              "release-helper@ops-workspace": true,
            },
          },
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
        mcpServers: [
          {
            name: "shared-docs",
            transport: "http",
            url: "https://example.invalid/mcp",
          },
        ],
      },
    });

    const resolved = await resolveWorkspace(root);
    expect(resolved.manifest.spec.plugins?.codex?.enabled).toEqual({
      "release-helper@ops-workspace": true,
    });
    expect(resolved.manifest.spec.plugins?.["claude-code"]?.marketplaces).toEqual({
      "ops-workspace": {
        source: {
          source: "directory",
          path: "./plugins",
        },
      },
    });
    expect(resolved.mcpServers).toEqual([
      {
        name: "shared-docs",
        transport: "http",
        url: "https://example.invalid/mcp",
      },
    ]);
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

    await expect(resolveWorkspace(root)).rejects.toThrow("is incompatible with framework 0.1.0");
  });
});
