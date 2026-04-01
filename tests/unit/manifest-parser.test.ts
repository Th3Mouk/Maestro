import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  loadWorkspaceManifest,
  mergeSpec,
  normalizeFragment,
} from "../../src/workspace/manifest-parser.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

function expectRecord(value: unknown): Record<string, unknown> {
  expect(value).not.toBeNull();
  expect(typeof value).toBe("object");
  return value as Record<string, unknown>;
}

describe("manifest parser merge semantics", () => {
  test("appends arrays instead of replacing them", () => {
    const merged = expectRecord(
      mergeSpec(
        {
          repositories: [{ name: "repo-a" }],
          skills: ["skill-a"],
          mcpServers: [{ name: "docs", transport: "http", url: "https://example.invalid/mcp" }],
        },
        {
          repositories: [{ name: "repo-b" }],
          skills: ["skill-b"],
          mcpServers: [{ name: "sentry", transport: "stdio", command: "npx" }],
        },
      ),
    );

    expect(merged["repositories"]).toEqual([{ name: "repo-a" }, { name: "repo-b" }]);
    expect(merged["skills"]).toEqual(["skill-a", "skill-b"]);
    expect(merged["mcpServers"]).toEqual([
      { name: "docs", transport: "http", url: "https://example.invalid/mcp" },
      { name: "sentry", transport: "stdio", command: "npx" },
    ]);
  });

  test("deep merges nested objects and preserves unrelated keys", () => {
    const merged = expectRecord(
      mergeSpec(
        {
          plugins: {
            codex: {
              enabled: {
                "release-helper@ops-workspace": true,
              },
            },
          },
          execution: {
            devcontainer: { enabled: true },
            worktrees: { enabled: true, rootDir: ".maestro/worktrees" },
          },
        },
        {
          plugins: {
            "claude-code": {
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
          execution: {
            worktrees: { branchPrefix: "task" },
          },
        },
      ),
    );

    expect(merged["plugins"]).toEqual({
      codex: {
        enabled: {
          "release-helper@ops-workspace": true,
        },
      },
      "claude-code": {
        marketplaces: {
          "ops-workspace": {
            source: {
              source: "directory",
              path: "./plugins",
            },
          },
        },
      },
    });
    expect(merged["execution"]).toEqual({
      devcontainer: { enabled: true },
      worktrees: {
        branchPrefix: "task",
        enabled: true,
        rootDir: ".maestro/worktrees",
      },
    });
  });

  test("handles non-object base safely by treating it as empty object", () => {
    const merged = expectRecord(
      mergeSpec(["not-an-object"], {
        runtimes: {
          codex: { enabled: true },
        },
      }),
    );

    expect(merged).toEqual({
      runtimes: {
        codex: { enabled: true },
      },
    });
  });
});

describe("manifest parser fragment normalization", () => {
  test("uses spec payload when fragment wraps keys under spec", () => {
    expect(
      normalizeFragment({
        apiVersion: "maestro/v1",
        kind: "WorkspaceFragment",
        spec: {
          policies: [{ name: "baseline" }],
        },
      }),
    ).toEqual({
      policies: [{ name: "baseline" }],
    });
  });

  test("keeps top-level object fragments as-is", () => {
    expect(
      normalizeFragment({
        packs: [{ name: "@maestro/pack-core", version: "^1.0.0" }],
      }),
    ).toEqual({
      packs: [{ name: "@maestro/pack-core", version: "^1.0.0" }],
    });
  });

  test("returns empty object for non-object fragment arrays", () => {
    expect(normalizeFragment(["invalid-fragment-shape"])).toEqual({});
  });
});

describe("manifest parser include loading", () => {
  test("discovers default fragments and deduplicates explicit includes", async () => {
    const root = await createManagedTempDir("maestro-parser-includes-");
    await mkdir(path.join(root, "fragments"), { recursive: true });

    await writeFile(
      path.join(root, "maestro.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: parser-includes",
        "spec:",
        "  includes:",
        "    - fragments/repositories.yaml",
        "  repositories:",
        "    - name: base-repo",
        "      remote: git@github.com:org/base-repo.git",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(root, "fragments", "repositories.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: WorkspaceFragment",
        "metadata:",
        "  name: repositories",
        "spec:",
        "  repositories:",
        "    - name: included-repo",
        "      remote: git@github.com:org/included-repo.git",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(root, "fragments", "policies.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: WorkspaceFragment",
        "metadata:",
        "  name: policies",
        "spec:",
        "  policies:",
        "    - name: baseline",
      ].join("\n"),
      "utf8",
    );

    const manifest = await loadWorkspaceManifest(root);
    expect(manifest.spec.repositories.map((repository) => repository.name)).toEqual([
      "base-repo",
      "included-repo",
    ]);
    expect(manifest.spec.policies?.map((policy) => policy.name)).toEqual(["baseline"]);
  });

  test("rejects include paths that escape the workspace root", async () => {
    const root = await createManagedTempDir("maestro-parser-escape-");

    await writeFile(
      path.join(root, "maestro.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: parser-escape",
        "spec:",
        "  includes:",
        "    - ../../etc/passwd",
        "  repositories:",
        "    - name: safe-repo",
        "      remote: git@github.com:org/safe-repo.git",
      ].join("\n"),
      "utf8",
    );

    await expect(loadWorkspaceManifest(root)).rejects.toThrow("workspace include escapes");
  });

  test("rejects absolute include paths that escape the workspace root", async () => {
    const root = await createManagedTempDir("maestro-parser-absolute-escape-");
    const outsideFragmentPath = path.resolve(root, "..", "outside-fragment.yaml");

    await writeFile(
      path.join(root, "maestro.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: parser-absolute-escape",
        "spec:",
        "  includes:",
        `    - ${outsideFragmentPath}`,
        "  repositories:",
        "    - name: safe-repo",
        "      remote: git@github.com:org/safe-repo.git",
      ].join("\n"),
      "utf8",
    );

    await expect(loadWorkspaceManifest(root)).rejects.toThrow("workspace include escapes");
  });
});
