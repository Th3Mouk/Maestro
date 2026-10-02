import { existsSync } from "node:fs";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createProgram } from "../../src/cli/main.js";
import { installWorkspace } from "../../src/core/commands.js";
import { createCommandContext } from "../../src/core/command-context.js";
import {
  runClaudeWorktreeCreateHook,
  runClaudeWorktreeRemoveHook,
} from "../../src/core/commands/claude-worktree-hook.js";
import { claudeWorktreeHookCommands } from "../../src/adapters/runtimes/index.js";
import { createLifecycleWorkspace } from "../utils/worktree-workspace.js";

const { readStdin } = vi.hoisted(() => ({
  readStdin: vi.fn<() => Promise<string>>(),
}));
vi.mock("../../src/cli/program/commands/stdin.js", () => ({ readStdin }));

const silentStderr = { isTTY: false, write: () => true } as unknown as NodeJS.WriteStream;
const context = () => createCommandContext({ stderr: silentStderr });

async function runHookCli(
  event: string,
  workspaceRoot: string,
  input: unknown,
): Promise<{ exitCode: number | string | undefined; stdout: string }> {
  readStdin.mockResolvedValue(JSON.stringify(input));
  const stdout: string[] = [];
  vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
    stdout.push(String(chunk));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  process.exitCode = undefined;
  await createProgram().parseAsync(["worktree", "hook", event, "--workspace", workspaceRoot], {
    from: "user",
  });
  const exitCode = process.exitCode;
  process.exitCode = undefined;
  return { exitCode, stdout: stdout.join("") };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("maestro worktree hook claude-create", () => {
  test("prints exactly one line on stdout: the resolved task root", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();

    const { exitCode, stdout } = await runHookCli("claude-create", workspaceRoot, {
      name: "Agent Task #1",
      session_id: "abc",
    });

    const taskRoot = await realpath(path.join(workspaceRoot, "worktrees", "agent-task-1"));
    expect(exitCode).toBe(0);
    expect(stdout).toBe(`${taskRoot}\n`);
    expect(existsSync(path.join(taskRoot, "repos", "foods", ".git"))).toBe(true);
  });

  test("from inside a task root, creates the task in the main workspace", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const outer = await runClaudeWorktreeCreateHook(workspaceRoot, '{"name":"outer"}', context());

    const inner = await runClaudeWorktreeCreateHook(
      outer.stdout ?? "",
      '{"name":"subagent"}',
      context(),
    );

    expect(inner.exitCode).toBe(0);
    expect(inner.stdout).toBe(await realpath(path.join(workspaceRoot, "worktrees", "subagent")));
  });

  test("rejects a name that sanitizes to nothing", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();

    const result = await runClaudeWorktreeCreateHook(workspaceRoot, '{"name":"///"}', context());

    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBeUndefined();
    expect(existsSync(path.join(workspaceRoot, "worktrees", "task"))).toBe(false);
  });
});

describe("maestro worktree hook claude-remove", () => {
  test("removes a clean task and exits 0", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const created = await runClaudeWorktreeCreateHook(workspaceRoot, '{"name":"done"}', context());

    const { exitCode } = await runHookCli("claude-remove", workspaceRoot, {
      worktree_path: created.stdout,
    });

    expect(exitCode).toBe(0);
    expect(existsSync(created.stdout ?? "")).toBe(false);
  });

  test("a dirty task exits 1 and stays", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const created = await runClaudeWorktreeCreateHook(workspaceRoot, '{"name":"busy"}', context());
    const wip = path.join(created.stdout ?? "", "repos", "foods", "WIP.txt");
    await writeFile(wip, "wip\n", "utf8");

    const result = await runClaudeWorktreeRemoveHook(
      workspaceRoot,
      JSON.stringify({ worktree_path: created.stdout }),
      context(),
    );

    expect(result.exitCode).toBe(1);
    expect(result.report?.issues.map((issue) => issue.code)).toEqual(["WORKTREE_DIRTY"]);
    expect(existsSync(wip)).toBe(true);
  });

  test("refuses a path outside rootDir", async () => {
    const { root, workspaceRoot } = await createLifecycleWorkspace();
    const elsewhere = path.join(root, "elsewhere", "task");
    await mkdir(elsewhere, { recursive: true });

    const result = await runClaudeWorktreeRemoveHook(
      workspaceRoot,
      JSON.stringify({ worktree_path: elsewhere }),
      context(),
    );

    expect(result.exitCode).toBe(1);
    expect(result.report).toBeUndefined();
    expect(existsSync(elsewhere)).toBe(true);
  });
});

describe("runtimes.claude-code.worktreeHooks projection", () => {
  async function setRuntimes(workspaceRoot: string, runtimesLine: string): Promise<void> {
    const manifestPath = path.join(workspaceRoot, "maestro.yaml");
    const manifest = await readFile(manifestPath, "utf8");
    await writeFile(
      manifestPath,
      manifest.replace(/^ {2}runtimes:.*$/m, `  runtimes: ${runtimesLine}`),
      "utf8",
    );
  }

  async function readSettings(workspaceRoot: string): Promise<Record<string, unknown>> {
    return JSON.parse(
      await readFile(path.join(workspaceRoot, ".claude", "settings.json"), "utf8"),
    ) as Record<string, unknown>;
  }

  test("merges both hooks idempotently, keeps foreign keys, and removes exactly them when off", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const settingsPath = path.join(workspaceRoot, ".claude", "settings.json");
    await mkdir(path.dirname(settingsPath), { recursive: true });
    const foreign = {
      permissions: { allow: ["Bash(git status)"] },
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./guard.sh" }] }],
        WorktreeCreate: [{ hooks: [{ type: "command", command: "./notify.sh" }] }],
      },
    };
    await writeFile(settingsPath, `${JSON.stringify(foreign, null, 2)}\n`, "utf8");
    await setRuntimes(workspaceRoot, '{ "claude-code": { worktreeHooks: true } }');

    await installWorkspace(workspaceRoot, {}, context());
    const once = await readSettings(workspaceRoot);
    await installWorkspace(workspaceRoot, {}, context());
    const twice = await readSettings(workspaceRoot);

    expect(twice).toEqual(once);
    expect(once.permissions).toEqual(foreign.permissions);
    expect(once.hooks).toEqual({
      PreToolUse: foreign.hooks.PreToolUse,
      WorktreeCreate: [
        ...foreign.hooks.WorktreeCreate,
        {
          hooks: [
            { type: "command", command: claudeWorktreeHookCommands.WorktreeCreate, timeout: 600 },
          ],
        },
      ],
      WorktreeRemove: [
        {
          hooks: [
            { type: "command", command: claudeWorktreeHookCommands.WorktreeRemove, timeout: 600 },
          ],
        },
      ],
    });

    await setRuntimes(workspaceRoot, '{ "claude-code": { worktreeHooks: false } }');
    await installWorkspace(workspaceRoot, {}, context());

    expect(await readSettings(workspaceRoot)).toEqual(foreign);
  });
});
