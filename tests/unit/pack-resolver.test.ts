import { mkdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { resolvePacks } from "../../src/workspace/pack-resolver.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";
import { writeYaml } from "../utils/yaml.js";

async function writePackManifest(
  packRoot: string,
  options?: {
    name?: string;
    frameworkCompatibility?: string;
  },
): Promise<void> {
  await mkdir(packRoot, { recursive: true });
  await writeYaml(path.join(packRoot, "pack.yaml"), {
    apiVersion: "maestro/v1",
    kind: "Pack",
    metadata: {
      name: options?.name ?? "@maestro/pack-core",
      version: "1.0.0",
    },
    spec: {
      compatibility: options?.frameworkCompatibility
        ? { framework: options.frameworkCompatibility }
        : undefined,
    },
  });
}

describe("pack resolver", () => {
  test("resolves a pack from an explicit relative source", async () => {
    const workspaceRoot = await createManagedTempDir("pack-resolver-source-");
    const packRoot = path.join(workspaceRoot, "packs", "core");
    await writePackManifest(packRoot);

    const resolved = await resolvePacks(
      workspaceRoot,
      [{ name: "@maestro/pack-core", source: "./packs/core" }],
      "1.2.3",
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.root).toBe(packRoot);
    expect(resolved[0]?.manifest.metadata.name).toBe("@maestro/pack-core");
  });

  test("resolves a pack from node_modules when source is omitted", async () => {
    const workspaceRoot = await createManagedTempDir("pack-resolver-node-modules-");
    const packageRoot = path.join(workspaceRoot, "node_modules", "@maestro", "pack-core");
    await writePackManifest(packageRoot);

    const resolved = await resolvePacks(workspaceRoot, [{ name: "@maestro/pack-core" }], "1.2.3");

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.root).toBe(packageRoot);
  });

  test("rejects relative sources that escape the allowed root", async () => {
    const workspaceRoot = await createManagedTempDir("pack-resolver-source-escape-");

    await expect(
      resolvePacks(
        workspaceRoot,
        [{ name: "@maestro/pack-core", source: "../../outside" }],
        "1.2.3",
      ),
    ).rejects.toThrow("pack source escapes the allowed root");
  });

  test("rejects absolute sources that escape the allowed root", async () => {
    const workspaceRoot = await createManagedTempDir("pack-resolver-absolute-escape-");
    const escapedAbsolutePath = path.resolve(workspaceRoot, "..", "..", "outside-pack");

    await expect(
      resolvePacks(
        workspaceRoot,
        [{ name: "@maestro/pack-core", source: escapedAbsolutePath }],
        "1.2.3",
      ),
    ).rejects.toThrow("pack source escapes the allowed root");
  });

  test("rejects nested traversal sources that escape the allowed root", async () => {
    const workspaceRoot = await createManagedTempDir("pack-resolver-nested-escape-");

    await expect(
      resolvePacks(
        workspaceRoot,
        [{ name: "@maestro/pack-core", source: "./packs/../../../outside" }],
        "1.2.3",
      ),
    ).rejects.toThrow("pack source escapes the allowed root");
  });

  test("fails with install hint when source is omitted and package is missing", async () => {
    const workspaceRoot = await createManagedTempDir("pack-resolver-missing-");

    await expect(
      resolvePacks(workspaceRoot, [{ name: "@maestro/pack-core" }], "1.2.3"),
    ).rejects.toThrow(
      "Cannot resolve pack @maestro/pack-core. Use spec.packs[].source or install the package.",
    );
  });

  test("rejects packs that are incompatible with the current framework version", async () => {
    const workspaceRoot = await createManagedTempDir("pack-resolver-incompatible-");
    const packRoot = path.join(workspaceRoot, "packs", "legacy");
    await writePackManifest(packRoot, {
      name: "@maestro/pack-legacy",
      frameworkCompatibility: ">=2.0.0",
    });

    await expect(
      resolvePacks(
        workspaceRoot,
        [{ name: "@maestro/pack-legacy", source: "./packs/legacy" }],
        "1.2.3",
      ),
    ).rejects.toThrow("Pack @maestro/pack-legacy is incompatible with framework 1.2.3");
  });

  test("accepts packs when framework version satisfies compatibility range", async () => {
    const workspaceRoot = await createManagedTempDir("pack-resolver-compatible-");
    const packRoot = path.join(workspaceRoot, "packs", "current");
    await writePackManifest(packRoot, {
      frameworkCompatibility: ">=1.0.0",
    });

    const resolved = await resolvePacks(
      workspaceRoot,
      [{ name: "@maestro/pack-core", source: "./packs/current" }],
      "1.2.3",
    );

    expect(resolved).toHaveLength(1);
    expect(resolved[0]?.manifest.metadata.name).toBe("@maestro/pack-core");
  });
});
