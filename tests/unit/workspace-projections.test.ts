import { describe, expect, test } from "vitest";
import { renderEditorWorkspace } from "../../src/core/editor-workspace.js";
import { renderWorkspaceDescriptor } from "../../src/core/workspace-descriptor.js";
import { createRepositoryFixture } from "../utils/execution-fixtures.js";

describe("workspace projections", () => {
  test("renders the editor workspace projection with stable structure and serialization", () => {
    const repositories = [
      createRepositoryFixture({
        name: "frontend",
      }),
      createRepositoryFixture({
        name: "backend",
      }),
    ];

    const rendered = renderEditorWorkspace({
      repositories,
      workspaceName: "demo-workspace",
    });

    const expected = {
      folders: [
        {
          name: "demo-workspace",
          path: ".",
        },
        {
          name: "frontend",
          path: "repos/frontend",
        },
        {
          name: "backend",
          path: "repos/backend",
        },
      ],
      settings: {
        "files.exclude": {
          repos: true,
          ".maestro/worktrees": true,
        },
      },
    };

    expect(JSON.parse(rendered)).toEqual(expected);
    expect(rendered).toBe(`${JSON.stringify(expected, null, 2)}\n`);
    expect(rendered.endsWith("\n")).toBe(true);
  });

  test("renders the workspace descriptor projection with stable structure and serialization", () => {
    const repositories = [
      createRepositoryFixture({
        name: "frontend",
        branch: "release",
        sparse: {
          visiblePaths: ["package.json", "src/**"],
        },
      }),
    ];

    const rendered = renderWorkspaceDescriptor({
      workspaceName: "demo-workspace",
      repositories,
      runtimeNames: ["codex"],
      execution: {
        devcontainer: { enabled: true },
        worktrees: { enabled: true },
      },
    });

    const expected = {
      schemaVersion: "maestro.workspace/v1",
      workspace: {
        name: "demo-workspace",
        root: ".",
        manifest: "maestro.yaml",
        agentsFile: "AGENTS.md",
      },
      layout: {
        repositoriesRoot: "repos",
        worktreesRoot: ".maestro/worktrees",
      },
      repositories: [
        {
          name: "frontend",
          path: "repos/frontend",
          remote: "git@github.com:org/frontend.git",
          referenceBranch: "release",
          sparsePaths: ["package.json", "src/**"],
        },
      ],
      projections: {
        runtimes: ["codex"],
        devcontainer: ".devcontainer/devcontainer.json",
      },
    };

    expect(JSON.parse(rendered)).toEqual(expected);
    expect(rendered).toBe(`${JSON.stringify(expected, null, 2)}\n`);
    expect(rendered.endsWith("\n")).toBe(true);
  });
});
