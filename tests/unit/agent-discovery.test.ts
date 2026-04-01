import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  resolveAgents,
  resolvePolicies,
  resolveSkills,
} from "../../src/workspace/agent-discovery.js";
import { packManifestSchema, workspaceManifestSchema } from "../../src/workspace/schema.js";
import type { PackManifest, PackResolution, WorkspaceManifest } from "../../src/workspace/types.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

function createManifest(spec: Partial<WorkspaceManifest["spec"]> = {}): WorkspaceManifest {
  return workspaceManifestSchema.parse({
    kind: "Workspace",
    metadata: { name: "agent-discovery-test" },
    spec: {
      repositories: [],
      ...spec,
    },
  });
}

function createPack(root: string, provides: PackManifest["spec"]["provides"] = {}): PackResolution {
  return {
    ref: {
      name: path.basename(root),
      source: root,
    },
    root,
    manifest: packManifestSchema.parse({
      kind: "Pack",
      metadata: {
        name: path.basename(root),
        version: "1.0.0",
      },
      spec: {
        provides,
      },
    }),
  };
}

describe("agent discovery", () => {
  test("keeps agent precedence override > workspace > pack > default", async () => {
    const root = await createManagedTempDir("agent-discovery-precedence-");
    const packRoot = path.join(root, "packs", "pack-a");
    await mkdir(path.join(root, "overrides", "agents", "codex"), { recursive: true });
    await mkdir(path.join(root, "agents", "codex"), { recursive: true });
    await mkdir(path.join(packRoot, "agents", "codex"), { recursive: true });

    await writeFile(
      path.join(root, "overrides", "agents", "codex", "alpha.toml"),
      'name = "alpha"\n',
    );
    await writeFile(path.join(root, "agents", "codex", "beta.toml"), 'name = "beta"\n');
    await writeFile(path.join(packRoot, "agents", "codex", "alpha.toml"), 'name = "alpha-pack"\n');
    await writeFile(path.join(packRoot, "agents", "codex", "beta.toml"), 'name = "beta-pack"\n');
    await writeFile(path.join(packRoot, "agents", "codex", "gamma.toml"), 'name = "gamma"\n');

    const manifest = createManifest({
      agents: { codex: ["alpha", "beta", "gamma", "delta"] },
    });
    const resolved = await resolveAgents(root, manifest, [
      createPack(packRoot, { agents: { codex: ["alpha", "beta", "gamma"] } }),
    ]);

    expect(resolved.codex.map((agent) => [agent.name, agent.source])).toEqual([
      ["alpha", "override"],
      ["beta", "workspace"],
      ["gamma", "pack"],
      ["delta", "default"],
    ]);
  });

  test("keeps agent conflict strategy behavior", async () => {
    const root = await createManagedTempDir("agent-discovery-agent-collision-");
    const firstPackRoot = path.join(root, "packs", "pack-a");
    const secondPackRoot = path.join(root, "packs", "pack-b");
    await mkdir(path.join(firstPackRoot, "agents", "codex"), { recursive: true });
    await mkdir(path.join(secondPackRoot, "agents", "codex"), { recursive: true });
    await writeFile(
      path.join(firstPackRoot, "agents", "codex", "planner.toml"),
      'prompt = "first"\n',
    );
    await writeFile(
      path.join(secondPackRoot, "agents", "codex", "planner.toml"),
      'prompt = "second"\n',
    );

    const packs = [
      createPack(firstPackRoot, { agents: { codex: ["planner"] } }),
      createPack(secondPackRoot, { agents: { codex: ["planner"] } }),
    ];

    await expect(
      resolveAgents(root, createManifest({ agents: { codex: ["planner"] } }), packs),
    ).rejects.toThrow("Agent collision for planner on runtime codex");

    const preferFirst = await resolveAgents(
      root,
      createManifest({
        agents: { codex: ["planner"] },
        conflicts: { agents: { planner: { strategy: "prefer-pack-first" } } },
      }),
      packs,
    );
    expect(preferFirst.codex[0]?.content).toContain('prompt = "first"');

    const preferLast = await resolveAgents(
      root,
      createManifest({
        agents: { codex: ["planner"] },
        conflicts: { agents: { planner: { strategy: "prefer-pack-last" } } },
      }),
      packs,
    );
    expect(preferLast.codex[0]?.content).toContain('prompt = "second"');
  });

  test("keeps skill precedence and conflict strategy behavior", async () => {
    const root = await createManagedTempDir("agent-discovery-skill-collision-");
    const firstPackRoot = path.join(root, "packs", "pack-a");
    const secondPackRoot = path.join(root, "packs", "pack-b");
    await mkdir(path.join(root, "overrides", "skills", "alpha"), { recursive: true });
    await mkdir(path.join(root, "skills", "beta"), { recursive: true });
    await mkdir(path.join(firstPackRoot, "skills", "alpha"), { recursive: true });
    await mkdir(path.join(firstPackRoot, "skills", "beta"), { recursive: true });
    await mkdir(path.join(firstPackRoot, "skills", "gamma"), { recursive: true });
    await mkdir(path.join(secondPackRoot, "skills", "gamma"), { recursive: true });

    await writeFile(
      path.join(root, "overrides", "skills", "alpha", "SKILL.md"),
      "# alpha override\n",
    );
    await writeFile(path.join(root, "skills", "beta", "SKILL.md"), "# beta workspace\n");
    await writeFile(path.join(firstPackRoot, "skills", "alpha", "SKILL.md"), "# alpha pack\n");
    await writeFile(path.join(firstPackRoot, "skills", "beta", "SKILL.md"), "# beta pack\n");
    await writeFile(path.join(firstPackRoot, "skills", "gamma", "SKILL.md"), "# gamma first\n");
    await writeFile(path.join(secondPackRoot, "skills", "gamma", "SKILL.md"), "# gamma second\n");

    const packs = [
      createPack(firstPackRoot, { skills: ["alpha", "beta", "gamma"] }),
      createPack(secondPackRoot, { skills: ["gamma"] }),
    ];

    await expect(resolveSkills(root, createManifest({ skills: ["gamma"] }), packs)).rejects.toThrow(
      "Skill collision for gamma",
    );

    const resolved = await resolveSkills(
      root,
      createManifest({
        skills: ["alpha", "beta", "gamma"],
        conflicts: { skills: { gamma: { strategy: "prefer-pack-last" } } },
      }),
      packs,
    );

    expect(resolved.map((skill) => [skill.name, skill.source])).toEqual([
      ["alpha", "override"],
      ["beta", "workspace"],
      ["gamma", "pack"],
    ]);
    expect(resolved[2]?.root).toBe(path.join(secondPackRoot, "skills", "gamma"));
  });

  test("keeps policy resolution precedence and source behavior", async () => {
    const root = await createManagedTempDir("agent-discovery-policy-");
    const packRoot = path.join(root, "packs", "pack-a");
    const secondPackRoot = path.join(root, "packs", "pack-b");
    await mkdir(path.join(root, "overrides", "policies"), { recursive: true });
    await mkdir(path.join(packRoot, "policies"), { recursive: true });
    await mkdir(path.join(secondPackRoot, "policies"), { recursive: true });

    await writeFile(
      path.join(root, "overrides", "policies", "override-only.yaml"),
      "spec:\n  allow: true\n",
    );
    await writeFile(path.join(packRoot, "policies", "from-pack.yaml"), "spec:\n  level: one\n");
    await writeFile(path.join(packRoot, "policies", "collision.yaml"), "spec:\n  side: first\n");
    await writeFile(
      path.join(secondPackRoot, "policies", "collision.yaml"),
      "spec:\n  side: second\n",
    );
    await writeFile(
      path.join(packRoot, "policies", "from-manifest-ref.yaml"),
      "spec:\n  via: pack\n",
    );

    const packs = [
      createPack(packRoot, { policies: ["from-pack"] }),
      createPack(secondPackRoot, { policies: [] }),
    ];

    const resolved = await resolvePolicies(
      root,
      createManifest({
        policies: [
          { name: "inline", spec: { source: "inline" } },
          { name: "override-only" },
          { name: "from-manifest-ref" },
          { name: "missing" },
        ],
      }),
      packs,
    );

    expect(resolved).toContainEqual({
      name: "inline",
      source: "manifest",
      spec: { source: "inline" },
    });
    expect(resolved).toContainEqual({
      name: "override-only",
      source: "override",
      spec: { allow: true },
    });
    expect(resolved).toContainEqual({
      name: "from-manifest-ref",
      source: "manifest",
      spec: { via: "pack" },
    });
    expect(resolved).toContainEqual({ name: "missing", source: "default", spec: {} });
    expect(resolved).toContainEqual({ name: "from-pack", source: "pack", spec: { level: "one" } });

    await expect(
      resolvePolicies(root, createManifest({ policies: [{ name: "collision" }] }), [
        createPack(packRoot, { policies: [] }),
        createPack(secondPackRoot, { policies: [] }),
      ]),
    ).rejects.toThrow("Policy collision for collision");
  });
});
