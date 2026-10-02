import { PassThrough } from "node:stream";
import { describe, expect, test } from "vitest";
import { pickTask, formatTaskRowLines } from "../../src/cli/program/commands/task-picker.js";
import {
  buildEditorLaunch,
  describeEditorLaunch,
  resolveEditorId,
} from "../../src/core/execution/editor-launch.js";
import type { TaskRow } from "../../src/core/execution-support/task-worktree-rows.js";

const target = {
  root: "/ws/worktrees/fix login",
  workspaceFile: "/ws/worktrees/fix login/fix-login.code-workspace",
};
const noPath = { PATH: "/nonexistent" };

describe("editor launches", () => {
  test.each([
    [
      "vscode",
      "darwin",
      { command: "open", args: ["-a", "Visual Studio Code", target.workspaceFile] },
    ],
    ["vscode", "linux", { command: "code", args: [target.workspaceFile] }],
    ["cursor", "darwin", { command: "open", args: ["-a", "Cursor", target.workspaceFile] }],
    ["cursor", "linux", { command: "cursor", args: [target.workspaceFile] }],
    ["devin", "darwin", { command: "open", args: ["-a", "Devin", target.workspaceFile] }],
    ["devin", "linux", { command: "devin-desktop", args: [target.workspaceFile] }],
    ["phpstorm", "darwin", { command: "open", args: ["-na", "PhpStorm", "--args", target.root] }],
    ["idea", "linux", { command: "idea", args: [target.root] }],
    ["webstorm", "darwin", { command: "open", args: ["-na", "WebStorm", "--args", target.root] }],
  ] as const)("%s on %s", async (editor, platform, expected) => {
    await expect(buildEditorLaunch(editor, target, { env: noPath, platform })).resolves.toEqual(
      expected,
    );
  });

  test("a task without a workspace file opens its root", async () => {
    await expect(
      buildEditorLaunch("vscode", { root: "/ws/t" }, { env: noPath, platform: "linux" }),
    ).resolves.toEqual({ command: "code", args: ["/ws/t"] });
  });

  test("none launches nothing", async () => {
    await expect(
      buildEditorLaunch("none", target, { env: noPath, platform: "darwin" }),
    ).resolves.toBeUndefined();
  });

  test("custom substitutes {root} and {workspaceFile}, shell-quoted", async () => {
    const launch = await buildEditorLaunch("custom", target, {
      env: { MAESTRO_EDITOR_COMMAND: "zed {root} --file {workspaceFile}" },
      platform: "linux",
    });

    expect(launch).toEqual({
      shell:
        "zed '/ws/worktrees/fix login' --file '/ws/worktrees/fix login/fix-login.code-workspace'",
    });
  });

  test("custom without $MAESTRO_EDITOR_COMMAND, and an unknown editor, are refused", async () => {
    await expect(
      buildEditorLaunch("custom", target, { env: {}, platform: "linux" }),
    ).rejects.toThrow(/MAESTRO_EDITOR_COMMAND/);
    await expect(
      buildEditorLaunch("emacs", target, { env: {}, platform: "linux" }),
    ).rejects.toThrow(/Unknown editor "emacs"/);
  });

  test("the launch description quotes arguments that need it", () => {
    expect(
      describeEditorLaunch({ command: "open", args: ["-a", "Visual Studio Code", "/a/b"] }),
    ).toBe("open -a 'Visual Studio Code' /a/b");
  });

  test("--editor wins over $MAESTRO_EDITOR, which wins over the manifest, then vscode", () => {
    expect(resolveEditorId("cursor", { MAESTRO_EDITOR: "idea" }, "devin")).toBe("cursor");
    expect(resolveEditorId(undefined, { MAESTRO_EDITOR: "idea" }, "devin")).toBe("idea");
    expect(resolveEditorId(undefined, {}, "devin")).toBe("devin");
    expect(resolveEditorId(undefined, {}, undefined)).toBe("vscode");
  });
});

describe("task picker without fzf", () => {
  const rows: TaskRow[] = [
    {
      name: "@root",
      repos: "all",
      uncommitted: "-",
      unlanded: "-",
      prunable: "-",
      age: "",
      extra: {},
    },
    {
      name: "fix login",
      repos: "foods",
      uncommitted: "foods",
      unlanded: "-",
      prunable: "-",
      age: "3d",
      extra: {},
    },
  ];

  async function pickWith(answer: string): Promise<{ picked: string | undefined; menu: string }> {
    const input = new PassThrough();
    const output = new PassThrough();
    let menu = "";
    output.on("data", (chunk: Buffer) => {
      menu += chunk.toString();
    });
    const picked = pickTask(rows, { env: noPath, input, output });
    input.end(`${answer}\n`);
    return { picked: await picked, menu };
  }

  test("a number picks that row from the menu written to the output", async () => {
    const { picked, menu } = await pickWith("2");

    expect(picked).toBe("fix login");
    expect(menu).toContain("  2 fix login");
  });

  test("a name picks that task, and an empty answer picks nothing", async () => {
    expect((await pickWith("@root")).picked).toBe("@root");
    expect((await pickWith("")).picked).toBeUndefined();
  });

  test("rows are aligned under a header", () => {
    expect(formatTaskRowLines(rows)).toEqual([
      "TASK       REPOS  UNCOMMITTED  UNLANDED  PRUNABLE  AGE",
      "@root      all    -            -         -",
      "fix login  foods  foods        -         -         3d",
    ]);
  });
});
