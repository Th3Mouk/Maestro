import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { readText } from "../../src/utils/fs.js";
import { loadWorkspaceManifest, resolveWorkspace } from "../../src/core/workspace-service.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

describe("workspace manifest loading", () => {
  test("merges includes and fragments deterministically", async () => {
    const root = await createManagedTempDir("maestro-manifest-");
    await mkdir(path.join(root, "fragments"), { recursive: true });

    await writeFile(
      path.join(root, "maestro.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: ops-workspace",
        "spec:",
        "  includes:",
        "    - fragments/packs.yaml",
        "    - fragments/repositories.yaml",
        "    - fragments/execution.yaml",
        "  runtimes:",
        "    codex:",
        "      enabled: true",
        "  agents:",
        "    codex:",
        "      - planner",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(root, "fragments", "packs.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: WorkspaceFragment",
        "metadata:",
        "  name: packs",
        "spec:",
        "  packs:",
        '    - name: "@maestro/pack-core"',
        "      version: ^1.0.0",
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
        "    - name: sur-api",
        "      remote: git@github.com:org/sur-api.git",
        "      branch: main",
        "      sparse:",
        "        visiblePaths:",
        "          - .github/",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(root, "fragments", "execution.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: WorkspaceFragment",
        "metadata:",
        "  name: execution",
        "spec:",
        "  execution:",
        "    devcontainer:",
        "      enabled: true",
        "    worktrees:",
        "      enabled: true",
        "      rootDir: .maestro/worktrees",
      ].join("\n"),
      "utf8",
    );

    const manifest = await loadWorkspaceManifest(root);
    expect(manifest.metadata.name).toBe("ops-workspace");
    expect(manifest.spec.packs?.[0]?.name).toBe("@maestro/pack-core");
    expect(manifest.spec.repositories[0]?.name).toBe("sur-api");
    expect(manifest.spec.execution?.devcontainer?.enabled).toBe(true);
    expect(manifest.spec.agents?.codex).toEqual(["planner"]);
    expect(await readText(path.join(root, "maestro.yaml"))).toContain("ops-workspace");
  });

  test("accepts repositories without sparse checkout configuration", async () => {
    const root = await createManagedTempDir("maestro-manifest-full-clone-");

    await writeFile(
      path.join(root, "maestro.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: full-clone",
        "spec:",
        "  repositories:",
        "    - name: example-repo",
        "      remote: git@github.com:org/example-repo.git",
      ].join("\n"),
      "utf8",
    );

    const manifest = await loadWorkspaceManifest(root);
    expect(manifest.spec.repositories[0]?.sparse).toBeUndefined();
  });

  test("rejects include paths that escape the workspace root", async () => {
    const root = await createManagedTempDir("maestro-manifest-escape-");

    await writeFile(
      path.join(root, "maestro.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: escaped",
        "spec:",
        "  includes:",
        "    - ../../etc/passwd",
        "  repositories:",
        "    - name: sur-api",
        "      remote: git@github.com:org/sur-api.git",
        "      sparse:",
        "        visiblePaths:",
        "          - .github/",
      ].join("\n"),
      "utf8",
    );

    await expect(loadWorkspaceManifest(root)).rejects.toThrow("workspace include escapes");
  });

  test("rejects devcontainer baseImage values with newline injection payloads", async () => {
    const root = await createManagedTempDir("maestro-base-image-validation-");

    await writeFile(
      path.join(root, "maestro.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: base-image-validation",
        "spec:",
        "  execution:",
        "    devcontainer:",
        '      baseImage: "ubuntu:22.04\\nRUN echo hacked"',
        "  repositories:",
        "    - name: sur-api",
        "      remote: git@github.com:org/sur-api.git",
        "      sparse:",
        "        visiblePaths:",
        "          - .github/",
      ].join("\n"),
      "utf8",
    );

    await expect(loadWorkspaceManifest(root)).rejects.toThrow("baseImage");
  });

  test("rejects pack sources that escape the workspace root", async () => {
    const root = await createManagedTempDir("maestro-pack-source-escape-");

    await writeFile(
      path.join(root, "maestro.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: escaped-pack-source",
        "spec:",
        "  packs:",
        "    - name: pack-core",
        "      source: ../../outside",
        "  repositories:",
        "    - name: sur-api",
        "      remote: git@github.com:org/sur-api.git",
        "      sparse:",
        "        visiblePaths:",
        "          - .github/",
      ].join("\n"),
      "utf8",
    );

    await expect(resolveWorkspace(root)).rejects.toThrow("pack source escapes");
  });

  test("rejects absolute pack sources that escape the allowed root", async () => {
    const root = await createManagedTempDir("maestro-pack-absolute-source-escape-");
    const escapedAbsolutePath = path.resolve(root, "..", "..", "outside-pack");

    await writeFile(
      path.join(root, "maestro.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: escaped-absolute-pack-source",
        "spec:",
        "  packs:",
        "    - name: pack-core",
        `      source: "${escapedAbsolutePath}"`,
        "  repositories:",
        "    - name: sur-api",
        "      remote: git@github.com:org/sur-api.git",
        "      sparse:",
        "        visiblePaths:",
        "          - .github/",
      ].join("\n"),
      "utf8",
    );

    await expect(resolveWorkspace(root)).rejects.toThrow("pack source escapes");
  });

  test("resolves absolute pack sources within the allowed root", async () => {
    const root = await createManagedTempDir("maestro-pack-absolute-source-allow-");
    const packRoot = path.join(root, "packs", "pack-core");
    await mkdir(packRoot, { recursive: true });

    await writeFile(
      path.join(packRoot, "pack.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Pack",
        "metadata:",
        "  name: pack-core",
        "  version: 1.0.0",
        "spec: {}",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(root, "maestro.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: absolute-pack-source",
        "spec:",
        "  packs:",
        "    - name: pack-core",
        `      source: "${packRoot}"`,
        "  repositories:",
        "    - name: sur-api",
        "      remote: git@github.com:org/sur-api.git",
        "      sparse:",
        "        visiblePaths:",
        "          - .github/",
      ].join("\n"),
      "utf8",
    );

    const resolved = await resolveWorkspace(root);
    expect(resolved.packs).toHaveLength(1);
    expect(resolved.packs[0]?.root).toBe(packRoot);
    expect(resolved.packs[0]?.manifest.metadata.name).toBe("pack-core");
  });

  test("rejects agent names that escape the workspace root", async () => {
    const root = await createManagedTempDir("maestro-agent-name-escape-");

    await writeFile(
      path.join(root, "maestro.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: escaped-agent-name",
        "spec:",
        "  agents:",
        "    codex:",
        "      - ../../planner",
        "  repositories:",
        "    - name: sur-api",
        "      remote: git@github.com:org/sur-api.git",
        "      sparse:",
        "        visiblePaths:",
        "          - .github/",
      ].join("\n"),
      "utf8",
    );

    await expect(resolveWorkspace(root)).rejects.toThrow("agent name escapes");
  });

  test("ignores backup-like agent files when probing workspace agents", async () => {
    const root = await createManagedTempDir("maestro-agent-backup-file-");
    await mkdir(path.join(root, "agents", "codex"), { recursive: true });

    await writeFile(
      path.join(root, "maestro.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: agent-backup-file",
        "spec:",
        "  agents:",
        "    codex:",
        "      - custom-agent",
        "  repositories:",
        "    - name: sur-api",
        "      remote: git@github.com:org/sur-api.git",
        "      sparse:",
        "        visiblePaths:",
        "          - .github/",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(root, "agents", "codex", "custom-agent.toml.bak"),
      'name = "custom-agent"\nprompt = "backup file should not be loaded"\n',
      "utf8",
    );

    const resolved = await resolveWorkspace(root);
    const selected = resolved.selectedAgents.codex.find((agent) => agent.name === "custom-agent");
    expect(selected).toBeDefined();
    expect(selected?.source).toBe("default");
    expect(selected?.filePath).toBeUndefined();
    expect(selected?.extension).toBe("toml");
  });

  test("rejects skill names that escape the workspace root", async () => {
    const root = await createManagedTempDir("maestro-skill-name-escape-");

    await writeFile(
      path.join(root, "maestro.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: escaped-skill-name",
        "spec:",
        "  skills:",
        "    - ../../registry-auth-audit",
        "  repositories:",
        "    - name: sur-api",
        "      remote: git@github.com:org/sur-api.git",
        "      sparse:",
        "        visiblePaths:",
        "          - .github/",
      ].join("\n"),
      "utf8",
    );

    await expect(resolveWorkspace(root)).rejects.toThrow("skill name escapes");
  });

  test("rejects policy names that escape the workspace root", async () => {
    const root = await createManagedTempDir("maestro-policy-name-escape-");

    await writeFile(
      path.join(root, "maestro.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: escaped-policy-name",
        "spec:",
        "  policies:",
        "    - name: ../../baseline",
        "  repositories:",
        "    - name: sur-api",
        "      remote: git@github.com:org/sur-api.git",
        "      sparse:",
        "        visiblePaths:",
        "          - .github/",
      ].join("\n"),
      "utf8",
    );

    await expect(resolveWorkspace(root)).rejects.toThrow("policy file escapes");
  });

  test("falls back to requested policy name and empty spec for invalid override policy YAML fields", async () => {
    const root = await createManagedTempDir("maestro-policy-override-parse-");
    await mkdir(path.join(root, "overrides", "policies"), { recursive: true });

    await writeFile(
      path.join(root, "maestro.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: policy-override-parse",
        "spec:",
        "  policies:",
        "    - name: baseline",
        "  repositories:",
        "    - name: sur-api",
        "      remote: git@github.com:org/sur-api.git",
        "      sparse:",
        "        visiblePaths:",
        "          - .github/",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(root, "overrides", "policies", "baseline.yaml"),
      ["name: 42", "spec: non-object-spec"].join("\n"),
      "utf8",
    );

    const resolved = await resolveWorkspace(root);
    expect(resolved.selectedPolicies).toContainEqual({
      name: "baseline",
      source: "override",
      spec: {},
    });
  });

  test("defaults execution settings from schema when execution is omitted", async () => {
    const root = await createManagedTempDir("maestro-execution-defaults-");

    await writeFile(
      path.join(root, "maestro.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: execution-defaults",
        "spec:",
        "  repositories:",
        "    - name: sur-api",
        "      remote: git@github.com:org/sur-api.git",
        "      sparse:",
        "        visiblePaths:",
        "          - .github/",
      ].join("\n"),
      "utf8",
    );

    const resolved = await resolveWorkspace(root);
    expect(resolved.execution).toEqual({
      devcontainer: { enabled: false },
      worktrees: { enabled: true },
    });
  });

  test("falls back to requested policy name and empty spec for invalid pack policy YAML fields", async () => {
    const root = await createManagedTempDir("maestro-policy-pack-parse-");
    const packRoot = path.join(root, "packs", "pack-policy");
    await mkdir(path.join(packRoot, "policies"), { recursive: true });

    await writeFile(
      path.join(root, "maestro.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Workspace",
        "metadata:",
        "  name: policy-pack-parse",
        "spec:",
        "  packs:",
        "    - name: pack-policy",
        "      source: ./packs/pack-policy",
        "  repositories:",
        "    - name: sur-api",
        "      remote: git@github.com:org/sur-api.git",
        "      sparse:",
        "        visiblePaths:",
        "          - .github/",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(packRoot, "pack.yaml"),
      [
        "apiVersion: maestro/v1",
        "kind: Pack",
        "metadata:",
        "  name: pack-policy",
        "  version: 1.0.0",
        "spec:",
        "  provides:",
        "    policies:",
        "      - baseline",
      ].join("\n"),
      "utf8",
    );

    await writeFile(
      path.join(packRoot, "policies", "baseline.yaml"),
      ["name: 42", "spec: not-an-object"].join("\n"),
      "utf8",
    );

    const resolved = await resolveWorkspace(root);
    expect(resolved.selectedPolicies).toContainEqual({
      name: "baseline",
      source: "pack",
      spec: {},
    });
  });
});
