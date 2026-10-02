import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { installWorkspace } from "../../src/core/commands.js";
import { createCommandContext } from "../../src/core/command-context.js";
import { createManagedTempDir } from "./test-lifecycle.js";

const gitIdentity = ["-c", "user.name=Test User", "-c", "user.email=test@example.invalid"];

export async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execa("git", [...gitIdentity, "-c", "commit.gpgSign=false", ...args], {
    cwd,
  });
  return stdout.trim();
}

async function createBareRemote(remotesRoot: string, name: string): Promise<string> {
  const sourceRoot = path.join(remotesRoot, `${name}-source`);
  const bareRoot = path.join(remotesRoot, `${name}.git`);
  await mkdir(sourceRoot, { recursive: true });
  await git(sourceRoot, ["init", "--initial-branch=main"]);
  await writeFile(path.join(sourceRoot, "README.md"), `# ${name}\n`, "utf8");
  await writeFile(path.join(sourceRoot, ".gitignore"), "vendor/\nnode_modules/\n", "utf8");
  await git(sourceRoot, ["add", "."]);
  await git(sourceRoot, ["commit", "-m", "Initial commit"]);
  await execa("git", ["clone", "--bare", sourceRoot, bareRoot]);
  return bareRoot;
}

export interface LifecycleScenario {
  remotes: Record<string, string>;
  root: string;
  workspaceRoot: string;
}

/**
 * A two-repository workspace (foods, platform-api) installed from local bare remotes.
 * `executionLines` are appended under `spec.execution.worktrees`.
 */
export async function createLifecycleWorkspace(
  options: { executionLines?: string[] } = {},
): Promise<LifecycleScenario> {
  const root = await createManagedTempDir("maestro-worktree-lifecycle-");
  const workspaceRoot = path.join(root, "workspace");
  const remotesRoot = path.join(root, "remotes");
  await mkdir(workspaceRoot, { recursive: true });
  await mkdir(remotesRoot, { recursive: true });

  const remotes = {
    foods: await createBareRemote(remotesRoot, "foods"),
    "platform-api": await createBareRemote(remotesRoot, "platform-api"),
  };

  await writeFile(
    path.join(workspaceRoot, "maestro.yaml"),
    [
      "apiVersion: maestro/v1",
      "kind: Workspace",
      "metadata:",
      "  name: lifecycle",
      "spec:",
      "  runtimes: {}",
      "  repositories:",
      ...Object.entries(remotes).flatMap(([name, remote]) => [
        `    - name: ${name}`,
        `      remote: ${remote}`,
        "      branch: main",
      ]),
      "  execution:",
      "    worktrees:",
      "      enabled: true",
      "      rootDir: worktrees",
      "      branchPrefix: platform",
      ...(options.executionLines ?? []).map((line) => `      ${line}`),
    ].join("\n"),
    "utf8",
  );

  const silentStderr = { isTTY: false, write: () => true } as unknown as NodeJS.WriteStream;
  await installWorkspace(workspaceRoot, {}, createCommandContext({ stderr: silentStderr }));
  await writeFile(
    path.join(workspaceRoot, ".gitignore"),
    `${await readFile(path.join(workspaceRoot, ".gitignore"), "utf8")}worktrees/\n`,
    "utf8",
  );
  await git(workspaceRoot, ["add", "."]);
  await git(workspaceRoot, ["commit", "-m", "Initial workspace"]);

  return { remotes, root, workspaceRoot };
}

export async function readTaskMetadata(taskRoot: string): Promise<{ repositories?: string[] }> {
  return JSON.parse(
    await readFile(path.join(taskRoot, ".maestro", "execution", "worktree.json"), "utf8"),
  ) as { repositories?: string[] };
}

export async function pushCommitToRemote(
  root: string,
  remote: string,
  message: string,
): Promise<string> {
  const cloneRoot = path.join(root, `push-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await execa("git", ["clone", remote, cloneRoot]);
  await git(cloneRoot, ["commit", "--allow-empty", "-m", message]);
  await git(cloneRoot, ["push", "origin", "main"]);
  return git(cloneRoot, ["rev-parse", "HEAD"]);
}

export async function branchExists(repoRoot: string, branch: string): Promise<boolean> {
  const { exitCode } = await execa(
    "git",
    ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`],
    {
      cwd: repoRoot,
      reject: false,
    },
  );
  return exitCode === 0;
}

/** Commits a file on the task's foods branch and pushes it with an upstream. */
export async function commitAndPushTaskWork(taskRoot: string, file: string): Promise<string> {
  const foods = path.join(taskRoot, "repos", "foods");
  await writeFile(path.join(foods, file), `${file}\n`, "utf8");
  await git(foods, ["add", file]);
  await git(foods, ["commit", "-m", `add ${file}`]);
  await git(foods, ["push", "-u", "origin", "HEAD"]);
  return git(foods, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

/** Squash-merges a branch into the remote main from a separate clone, then deletes it remotely. */
export async function squashMergeOnRemote(
  root: string,
  remote: string,
  branch: string,
): Promise<void> {
  const cloneRoot = path.join(root, `squash-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await execa("git", ["clone", remote, cloneRoot]);
  await git(cloneRoot, ["merge", "--squash", `origin/${branch}`]);
  await git(cloneRoot, ["commit", "-m", `squash ${branch}`]);
  await git(cloneRoot, ["push", "origin", "main"]);
  await git(cloneRoot, ["push", "origin", "--delete", branch]);
}
