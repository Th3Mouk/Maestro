import { describe, expect, test } from "vitest";
import { listRuntimeProjectionDirs } from "../../src/runtime/types.js";
import { canonicalRuntimes, normalizeRuntimes } from "../../src/workspace/runtimes.js";
import { workspaceManifestSchema } from "../../src/workspace/schema.js";
import type { WorkspaceManifest } from "../../src/workspace/types.js";

function manifestWith(spec: Record<string, unknown>): WorkspaceManifest {
  return workspaceManifestSchema.parse({
    kind: "Workspace",
    metadata: { name: "runtime-normalization" },
    spec: { repositories: [], ...spec },
  });
}

describe("normalizeRuntimes", () => {
  test("applies the canonical layout when spec.runtimes is omitted", () => {
    expect(normalizeRuntimes(manifestWith({}))).toEqual({
      standard: { skills: { mode: "merge", strategy: "copy" } },
      "claude-code": {
        skills: { mode: "merge", strategy: "symlink" },
        workflows: { mode: "merge" },
      },
    });
    expect(normalizeRuntimes(manifestWith({ runtimes: canonicalRuntimes }))).toEqual(
      normalizeRuntimes(manifestWith({})),
    );
  });

  test("projects nothing when spec.runtimes is an explicit empty object", () => {
    expect(normalizeRuntimes(manifestWith({ runtimes: {} }))).toEqual({});
  });

  test("keeps agent projection off until a runtime defines agents", () => {
    const runtimes = normalizeRuntimes(
      manifestWith({
        runtimes: {
          "claude-code": { enabled: true },
          codex: { agents: true },
          copilot: { agents: {} },
          cursor: { agents: { mode: "replace" } },
          gemini: { enabled: true },
        },
      }),
    );

    expect(runtimes["claude-code"]?.agents).toBeUndefined();
    expect(runtimes.codex).toEqual({ agents: { mode: "merge" } });
    expect(runtimes.copilot).toEqual({ agents: { mode: "merge" } });
    expect(runtimes.cursor).toEqual({ agents: { mode: "replace" } });
    expect(runtimes.gemini).toEqual({});
  });

  test("lets each asset override the runtime-wide projectionMode or opt out", () => {
    const runtimes = normalizeRuntimes(
      manifestWith({
        runtimes: {
          standard: { skills: false, agents: true },
          "claude-code": {
            projectionMode: "replace",
            skills: { mode: "merge", strategy: "copy" },
            agents: {},
            workflows: false,
          },
        },
      }),
    );

    expect(runtimes.standard).toEqual({ agents: { mode: "merge" } });
    expect(runtimes["claude-code"]).toEqual({
      skills: { mode: "merge", strategy: "copy" },
      agents: { mode: "replace" },
    });
  });

  test("skips a runtime with enabled: false", () => {
    expect(
      normalizeRuntimes(manifestWith({ runtimes: { codex: { enabled: false, agents: true } } })),
    ).toEqual({});
  });

  test("drops the removed instruction-file keys from a legacy manifest", () => {
    const manifest = manifestWith({
      runtimes: {
        "claude-code": {
          enabled: true,
          installProjectInstructions: true,
          instructionsFile: "CLAUDE.md",
        },
      },
    });

    expect(manifest.spec.runtimes?.["claude-code"]).toEqual({ enabled: true });
  });

  test("rejects an unsupported asset projection mode", () => {
    expect(() => manifestWith({ runtimes: { codex: { agents: { mode: "wipe" } } } })).toThrow(
      "mode",
    );
  });
});

describe("listRuntimeProjectionDirs", () => {
  test("lists only the directories of active projections", () => {
    expect(
      listRuntimeProjectionDirs({
        standard: { skills: {} },
        "claude-code": { skills: {}, workflows: {} },
        codex: { agents: {} },
      }),
    ).toEqual([".agents/skills", ".claude/skills", ".claude/workflows", ".codex/agents"]);
  });

  test("lists every supported target without an active filter", () => {
    expect(listRuntimeProjectionDirs()).toEqual([
      ".agents/skills",
      ".agents/agents",
      ".claude/skills",
      ".claude/agents",
      ".claude/workflows",
      ".codex/agents",
      ".cursor/agents",
      ".github/agents",
      ".gemini/agents",
      ".opencode/agents",
      ".kilo/agents",
      ".devin/agents",
    ]);
  });
});
