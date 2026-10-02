import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { launchEditorProcess } from "../../src/adapters/editor/editor-launcher.js";
import { ForgeUnavailableError, GitHubForgeClient } from "../../src/adapters/forge/github-forge.js";
import { HumanRenderer } from "../../src/cli/output/human-renderer.js";
import { registerShellInitCommand } from "../../src/cli/program/commands/register-shell-init-command.js";
import { readStdin } from "../../src/cli/program/commands/stdin.js";
import type { TaskWorktreeReport, WorktreePruneReport } from "../../src/report/types.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

function capture(write: (stream: NodeJS.WritableStream) => void): string {
  let output = "";
  write({
    write: (chunk: string) => {
      output += chunk;
      return true;
    },
  } as unknown as NodeJS.WritableStream);
  return output;
}

describe("readStdin", () => {
  test("reads the whole stream as UTF-8", async () => {
    const stream = new PassThrough();
    const read = readStdin(stream);
    stream.write('{"name":');
    stream.end(Buffer.from('"é"}'));

    expect(await read).toBe('{"name":"é"}');
  });
});

describe("launchEditorProcess", () => {
  test("waits for a launcher command and a custom shell command", async () => {
    await expect(launchEditorProcess({ command: "true", args: [] })).resolves.toBeUndefined();
    await expect(launchEditorProcess({ shell: "exit 0" })).resolves.toBeUndefined();
  });

  test("rejects when the launcher fails or is missing", async () => {
    await expect(launchEditorProcess({ shell: "echo nope >&2; exit 3" })).rejects.toThrow(/nope/);
    await expect(
      launchEditorProcess({ command: "maestro-no-such-editor", args: [] }),
    ).rejects.toThrow(/ENOENT/);
  });
});

describe("GitHubForgeClient with a gh on PATH", () => {
  async function stubGh(script: string): Promise<string> {
    const bin = await createManagedTempDir("maestro-gh-");
    await writeFile(path.join(bin, "gh"), `#!/bin/sh\n${script}\n`, "utf8");
    await chmod(path.join(bin, "gh"), 0o755);
    vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
    return path.join(bin, "args.log");
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test("asks for merged pull requests of the head branch and returns the merged one", async () => {
    const log = await stubGh(
      `echo "$@" > "$(dirname "$0")/args.log"; echo '[{"number":2028,"mergedAt":"2026-09-01T00:00:00Z"}]'`,
    );

    const result = await new GitHubForgeClient().findMergedPullRequest(
      "git@github.com:positive/foods.git",
      "platform/x/foods",
    );

    expect(result).toEqual({ number: 2028 });
    expect((await readFile(log, "utf8")).trim()).toBe(
      "pr list --repo positive/foods --head platform/x/foods --state merged --json number,mergedAt",
    );
  });

  test("no merged pull request, and an unauthenticated gh", async () => {
    await stubGh("echo '[]'");
    await expect(
      new GitHubForgeClient().findMergedPullRequest("https://github.com/positive/foods", "b"),
    ).resolves.toBeUndefined();

    await stubGh("echo 'gh auth login' >&2; exit 4");
    await expect(
      new GitHubForgeClient().findMergedPullRequest("https://github.com/positive/foods", "b"),
    ).rejects.toBeInstanceOf(ForgeUnavailableError);
  });
});

describe("maestro shell-init command", () => {
  let stdout: string[];
  let stderr: string[];

  beforeEach(() => {
    stdout = [];
    stderr = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    process.exitCode = undefined;
  });

  async function run(args: string[]): Promise<void> {
    const program = new Command();
    program.exitOverride();
    registerShellInitCommand(program);
    await program.parseAsync(["shell-init", ...args], { from: "user" });
  }

  test("prints the function for $SHELL, under --name", async () => {
    vi.stubEnv("SHELL", "/bin/zsh");

    await run(["--name", "go"]);

    expect(stdout.join("")).toMatch(/^go\(\) \{/);
  });

  test("--install and --uninstall edit the rc file", async () => {
    const home = await createManagedTempDir("maestro-shell-cli-");
    await mkdir(home, { recursive: true });
    vi.stubEnv("HOME", home);

    await run(["bash", "--install"]);
    await run(["bash", "--install"]);
    await run(["bash", "--uninstall"]);

    expect(stdout).toEqual([
      `maestro shell-init: added to ${path.join(home, ".bashrc")}\n`,
      `maestro shell-init: ${path.join(home, ".bashrc")} unchanged\n`,
      `maestro shell-init: removed from ${path.join(home, ".bashrc")}\n`,
    ]);
    expect(await readFile(path.join(home, ".bashrc"), "utf8")).toBe("");
  });

  test("refuses an unknown $SHELL, a bad name, and both flags at once", async () => {
    vi.stubEnv("SHELL", "/bin/tcsh");
    await run([]);
    await run(["zsh", "--name", "bad name"]);
    await run(["zsh", "--install", "--uninstall"]);

    expect(stderr.join("")).toContain('Unsupported shell "tcsh"');
    expect(stderr.join("")).toContain('"bad name" is not a valid shell function name');
    expect(stderr.join("")).toContain("either --install or --uninstall");
    expect(process.exitCode).toBe(1);
  });
});

describe("human reports with hooks and forge evidence", () => {
  test("create lists its hook runs", () => {
    const report: TaskWorktreeReport = {
      status: "warning",
      workspace: "ws",
      name: "a",
      root: "/ws/worktrees/a",
      repositories: [],
      hooks: [{ hook: "postCreate", command: "./seed", status: "failed", exitCode: 2 }],
      issues: [{ code: "HOOK_FAILED", message: "postCreate hook `./seed` failed (exit 2)." }],
    };

    const output = capture((stream) =>
      new HumanRenderer("worktree-create", { color: false }).render(report, stream),
    );

    expect(output).toContain("Hooks:\n  - postCreate failed: ./seed");
  });

  test("prune shows the merged pull requests and the planned hooks per task", () => {
    const report: WorktreePruneReport = {
      status: "ok",
      workspace: "ws",
      dryRun: true,
      removed: ["landed"],
      deletedBranches: [{ name: "foods", branch: "platform/old/foods" }],
      kept: [],
      mergedPullRequests: [
        { item: "landed", checkout: "foods", pr: 2028 },
        { item: "platform/old/foods", checkout: "foods", pr: 7 },
      ],
      hooks: [{ hook: "preRemove", command: "./down", status: "planned", task: "landed" }],
      issues: [],
    };

    const output = capture((stream) =>
      new HumanRenderer("worktree-prune", { color: true }).render(report, stream),
    );

    expect(output).toContain("foods merged in #2028");
    expect(output).toContain("merged in #7");
    expect(output).toContain("./down");
    expect(output).toContain("[landed]");
  });
});
