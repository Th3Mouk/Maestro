import { describe, expect, test } from "vitest";
import {
  listWorktreeHookCommands,
  runWorktreeHooks,
} from "../../src/core/execution/worktree-hooks.js";
import { workspaceManifestSchema } from "../../src/workspace/schema.js";
import type { PackManifest } from "../../src/workspace/types.js";
import { createResolvedWorkspaceFixture } from "../utils/execution-fixtures.js";

function packWithHooks(name: string, postCreate: string[]): PackManifest {
  return {
    apiVersion: "maestro/v1",
    kind: "Pack",
    metadata: { name, version: "1.0.0" },
    spec: { provides: { hooks: { worktreePostCreate: postCreate } } },
  };
}

function collectingStream(): { stream: NodeJS.WritableStream; text: () => string } {
  const chunks: string[] = [];
  return {
    stream: {
      write: (chunk: string) => {
        chunks.push(chunk);
        return true;
      },
    } as unknown as NodeJS.WritableStream,
    text: () => chunks.join(""),
  };
}

describe("worktree hook commands", () => {
  test("pack hooks run before the manifest hooks, each in declaration order", () => {
    const resolvedWorkspace = createResolvedWorkspaceFixture({
      execution: {
        worktrees: { enabled: true, hooks: { postCreate: ["manifest-a", "manifest-b"] } },
      },
    });
    resolvedWorkspace.packs = [
      { ref: { name: "first" }, root: "/packs/first", manifest: packWithHooks("first", ["p1"]) },
      { ref: { name: "second" }, root: "/packs/second", manifest: packWithHooks("second", ["p2"]) },
    ];

    expect(listWorktreeHookCommands(resolvedWorkspace, "postCreate")).toEqual([
      { command: "p1", packRoot: "/packs/first" },
      { command: "p2", packRoot: "/packs/second" },
      { command: "manifest-a" },
      { command: "manifest-b" },
    ]);
    expect(listWorktreeHookCommands(resolvedWorkspace, "preRemove")).toEqual([]);
  });

  test("a pack hook sees its pack root, and stdout and stderr are prefixed on stderr", async () => {
    const { stream, text } = collectingStream();

    const result = await runWorktreeHooks(
      [{ command: 'echo "$MAESTRO_PACK_ROOT"; echo warn >&2', packRoot: "/packs/first" }],
      {
        hook: "postCreate",
        stderr: stream,
        task: { name: "t", repositories: [], root: "/tmp" },
        trigger: "create",
        workspaceRoot: process.cwd(),
      },
    );

    expect(result.failure).toBeUndefined();
    expect(text()).toContain("[postCreate] /packs/first\n");
    expect(text()).toContain("[postCreate] warn\n");
  });

  test("stops at the first failing command", async () => {
    const { stream } = collectingStream();

    const result = await runWorktreeHooks([{ command: "exit 5" }, { command: "echo never" }], {
      hook: "preRemove",
      stderr: stream,
      task: { name: "t", repositories: ["a", "b"], root: "/tmp" },
      trigger: "prune",
      workspaceRoot: process.cwd(),
    });

    expect(result.runs).toEqual([
      { hook: "preRemove", command: "exit 5", status: "failed", exitCode: 5, task: "t" },
    ]);
    expect(result.failure).toMatchObject({ command: "exit 5", exitCode: 5 });
  });

  test("the manifest accepts worktree hooks", () => {
    const manifest = workspaceManifestSchema.parse({
      kind: "Workspace",
      metadata: { name: "hooks" },
      spec: {
        repositories: [],
        execution: {
          worktrees: {
            hooks: {
              postCreate: ["./scripts/seed-deps"],
              preRemove: ['./scripts/platform-down "$MAESTRO_TASK"'],
            },
          },
        },
      },
    });

    expect(manifest.spec.execution?.worktrees?.hooks).toEqual({
      postCreate: ["./scripts/seed-deps"],
      preRemove: ['./scripts/platform-down "$MAESTRO_TASK"'],
    });
  });
});
