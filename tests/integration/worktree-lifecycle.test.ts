import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { execa } from "execa";
import { describe, expect, test } from "vitest";
import { installWorkspace } from "../../src/core/commands.js";
import { createCommandContext } from "../../src/core/command-context.js";
import {
  createTaskWorktree,
  listTaskWorktrees,
  removeTaskWorktree,
} from "../../src/core/commands/execution.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

const gitIdentity = ["-c", "user.name=Test User", "-c", "user.email=test@example.invalid"];

async function git(cwd: string, args: string[]): Promise<string> {
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

interface LifecycleScenario {
  remotes: Record<string, string>;
  root: string;
  workspaceRoot: string;
}

/** A two-repository workspace (foods, platform-api) installed from local bare remotes. */
async function createLifecycleWorkspace(): Promise<LifecycleScenario> {
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

describe("worktree remove keeps uncommitted work", () => {
  test("a dirty repository leaves the whole task untouched and exits with an error", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const created = await createTaskWorktree(workspaceRoot, "rm-probe");
    const unsavedFile = path.join(created.root, "repos", "foods", "UNSAVED.txt");
    await writeFile(unsavedFile, "important\n", "utf8");

    const report = await removeTaskWorktree(workspaceRoot, "rm-probe");

    expect(report.status).toBe("error");
    expect(report.issues).toEqual([
      expect.objectContaining({
        code: "WORKTREE_DIRTY",
        path: path.join(created.root, "repos", "foods"),
        changedFiles: 1,
      }),
    ]);
    expect(await readFile(unsavedFile, "utf8")).toBe("important\n");
    expect(existsSync(path.join(created.root, "repos", "platform-api", ".git"))).toBe(true);
    expect(existsSync(path.join(created.root, ".git"))).toBe(true);
  });

  test("a modified tracked file in the workspace-root worktree counts as dirty", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const created = await createTaskWorktree(workspaceRoot, "root-dirty");
    await writeFile(path.join(created.root, "maestro.yaml"), "# edited\n", "utf8");

    const report = await removeTaskWorktree(workspaceRoot, "root-dirty");

    expect(report.status).toBe("error");
    expect(report.issues.map((issue) => issue.path)).toEqual([created.root]);
    expect(existsSync(created.root)).toBe(true);
  });

  test("ignored files do not block the removal", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const created = await createTaskWorktree(workspaceRoot, "ignored-only");
    const vendorDir = path.join(created.root, "repos", "foods", "vendor");
    await mkdir(vendorDir, { recursive: true });
    await writeFile(path.join(vendorDir, "autoload.php"), "<?php\n", "utf8");

    const report = await removeTaskWorktree(workspaceRoot, "ignored-only");

    expect(report.status).toBe("ok");
    expect(existsSync(created.root)).toBe(false);
    expect(
      await git(path.join(workspaceRoot, "repos", "foods"), ["worktree", "list"]),
    ).not.toContain("ignored-only");
  });

  test("--force discards the uncommitted work", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const created = await createTaskWorktree(workspaceRoot, "force-probe");
    await writeFile(path.join(created.root, "repos", "foods", "UNSAVED.txt"), "x\n", "utf8");

    const report = await removeTaskWorktree(workspaceRoot, "force-probe", { force: true });

    expect(report.status).toBe("ok");
    expect(existsSync(created.root)).toBe(false);
  });
});

describe("worktree create keeps existing task branches", () => {
  test("create, commit, remove, create again keeps the commit as the branch tip", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const first = await createTaskWorktree(workspaceRoot, "reset-probe");
    const foodsWorktree = path.join(first.root, "repos", "foods");
    await git(foodsWorktree, ["commit", "--allow-empty", "-m", "probe commit"]);
    await git(first.root, ["commit", "--allow-empty", "-m", "root probe commit"]);
    const foodsTip = await git(foodsWorktree, ["rev-parse", "HEAD"]);
    const rootTip = await git(first.root, ["rev-parse", "HEAD"]);

    expect((await removeTaskWorktree(workspaceRoot, "reset-probe")).status).toBe("ok");
    const second = await createTaskWorktree(workspaceRoot, "reset-probe");

    expect(second.status).toBe("ok");
    expect(second.repositories.find((entry) => entry.name === "foods")?.status).toBe("reused");
    expect(await git(foodsWorktree, ["rev-parse", "HEAD"])).toBe(foodsTip);
    expect(await git(foodsWorktree, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
      "platform/reset-probe/foods",
    );
    expect(await git(second.root, ["rev-parse", "HEAD"])).toBe(rootTip);
  });

  test("a new task branch starts from the reference branch", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();

    const report = await createTaskWorktree(workspaceRoot, "fresh");

    expect(report.repositories.map((entry) => entry.status)).toEqual(["created", "created"]);
    expect(await git(path.join(report.root, "repos", "foods"), ["rev-parse", "HEAD"])).toBe(
      await git(path.join(workspaceRoot, "repos", "foods"), ["rev-parse", "main"]),
    );
  });
});

async function readTaskMetadata(taskRoot: string): Promise<{ repositories?: string[] }> {
  return JSON.parse(
    await readFile(path.join(taskRoot, ".maestro", "execution", "worktree.json"), "utf8"),
  ) as { repositories?: string[] };
}

describe("partial worktrees with --repos", () => {
  test("only the selected repositories get a worktree, and the metadata records them", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();

    const report = await createTaskWorktree(workspaceRoot, "one-repo", { repos: ["foods"] });

    expect(report.status).toBe("ok");
    expect(report.repositories.map((entry) => entry.name)).toEqual(["foods"]);
    expect(existsSync(path.join(report.root, "repos", "foods", ".git"))).toBe(true);
    expect(existsSync(path.join(report.root, "repos", "platform-api"))).toBe(false);
    expect((await readTaskMetadata(report.root)).repositories).toEqual(["foods"]);
    const descriptor = JSON.parse(
      await readFile(path.join(report.root, "maestro.json"), "utf8"),
    ) as {
      repositories: Array<{ name: string }>;
    };
    expect(descriptor.repositories.map((entry) => entry.name)).toEqual(["foods"]);
  });

  test("a second create --repos adds a repository and a remove removes both and nothing else", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const first = await createTaskWorktree(workspaceRoot, "grow", { repos: ["foods"] });
    await git(path.join(first.root, "repos", "foods"), ["commit", "--allow-empty", "-m", "wip"]);
    const foodsTip = await git(path.join(first.root, "repos", "foods"), ["rev-parse", "HEAD"]);
    const other = await createTaskWorktree(workspaceRoot, "other", { repos: ["platform-api"] });

    const second = await createTaskWorktree(workspaceRoot, "grow", { repos: ["platform-api"] });

    expect(second.repositories.map((entry) => entry.name)).toEqual(["platform-api"]);
    expect(await git(path.join(first.root, "repos", "foods"), ["rev-parse", "HEAD"])).toBe(
      foodsTip,
    );
    expect((await readTaskMetadata(first.root)).repositories).toEqual(["foods", "platform-api"]);
    expect((await listTaskWorktrees(workspaceRoot)).worktrees).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "grow", repositories: ["foods", "platform-api"] }),
      ]),
    );

    const removed = await removeTaskWorktree(workspaceRoot, "grow");

    expect(removed.status).toBe("ok");
    expect(removed.repositories.map((entry) => [entry.name, entry.status])).toEqual([
      ["foods", "removed"],
      ["platform-api", "removed"],
    ]);
    expect(existsSync(first.root)).toBe(false);
    expect(existsSync(path.join(other.root, "repos", "platform-api", ".git"))).toBe(true);
  });

  test("an unknown repository fails the command and creates nothing", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();

    const report = await createTaskWorktree(workspaceRoot, "typo", { repos: ["foods", "fods"] });

    expect(report.status).toBe("error");
    expect(report.issues).toEqual([expect.objectContaining({ code: "REPO_UNKNOWN" })]);
    expect(existsSync(report.root)).toBe(false);
  });

  test("remove falls back to the directories under repos/ for metadata without the list", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    // Metadata written by 0.6: no repository list, no generated-file fingerprints.
    const created = await createTaskWorktree(workspaceRoot, "legacy");
    await writeFile(
      path.join(created.root, ".maestro", "execution", "worktree.json"),
      JSON.stringify({ name: "legacy", createdAt: "2026-01-01T00:00:00.000Z" }),
      "utf8",
    );

    const removed = await removeTaskWorktree(workspaceRoot, "legacy");

    expect(removed.issues).toEqual([]);
    expect(removed.repositories.map((entry) => entry.name)).toEqual(["foods", "platform-api"]);
    expect(existsSync(created.root)).toBe(false);
  });

  test("files Maestro wrote into the task root only count once they are edited", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    // The narrowed descriptor differs from the committed maestro.json.
    const created = await createTaskWorktree(workspaceRoot, "generated", { repos: ["foods"] });
    expect(await git(created.root, ["status", "--porcelain"])).toContain("maestro.json");

    await writeFile(path.join(created.root, "maestro.json"), "{}\n", "utf8");
    const refused = await removeTaskWorktree(workspaceRoot, "generated");
    expect(refused.issues).toEqual([
      expect.objectContaining({ code: "WORKTREE_DIRTY", path: created.root, changedFiles: 1 }),
    ]);

    await createTaskWorktree(workspaceRoot, "generated", { repos: ["foods"] });
    const removed = await removeTaskWorktree(workspaceRoot, "generated");
    expect(removed.issues).toEqual([]);
    expect(removed.status).toBe("ok");
    expect(existsSync(created.root)).toBe(false);
  });
});

async function pushCommitToRemote(root: string, remote: string, message: string): Promise<string> {
  const cloneRoot = path.join(root, `push-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await execa("git", ["clone", remote, cloneRoot]);
  await git(cloneRoot, ["commit", "--allow-empty", "-m", message]);
  await git(cloneRoot, ["push", "origin", "main"]);
  return git(cloneRoot, ["rev-parse", "HEAD"]);
}

describe("base refs", () => {
  test("a new repository task branch starts from the freshly fetched origin branch", async () => {
    const { remotes, root, workspaceRoot } = await createLifecycleWorkspace();
    const remoteTip = await pushCommitToRemote(root, remotes.foods, "landed upstream");
    const localMain = await git(path.join(workspaceRoot, "repos", "foods"), ["rev-parse", "main"]);

    const report = await createTaskWorktree(workspaceRoot, "fresh-base", { repos: ["foods"] });

    expect(report.status).toBe("ok");
    expect(await git(path.join(report.root, "repos", "foods"), ["rev-parse", "HEAD"])).toBe(
      remoteTip,
    );
    // The primary clone's checked-out branch is not moved.
    expect(await git(path.join(workspaceRoot, "repos", "foods"), ["rev-parse", "main"])).toBe(
      localMain,
    );
  });

  test("--offline keeps the local reference branch", async () => {
    const { remotes, root, workspaceRoot } = await createLifecycleWorkspace();
    await pushCommitToRemote(root, remotes.foods, "landed upstream");
    const localMain = await git(path.join(workspaceRoot, "repos", "foods"), ["rev-parse", "main"]);

    const report = await createTaskWorktree(workspaceRoot, "offline", {
      repos: ["foods"],
      offline: true,
    });

    expect(await git(path.join(report.root, "repos", "foods"), ["rev-parse", "HEAD"])).toBe(
      localMain,
    );
  });

  test("a fetch failure is a warning and the local reference branch is used", async () => {
    const { root, workspaceRoot } = await createLifecycleWorkspace();
    const foodsClone = path.join(workspaceRoot, "repos", "foods");
    await git(foodsClone, ["remote", "set-url", "origin", path.join(root, "missing.git")]);

    const report = await createTaskWorktree(workspaceRoot, "no-network", { repos: ["foods"] });

    expect(report.status).toBe("warning");
    expect(report.issues).toEqual([expect.objectContaining({ code: "FETCH_FAILED" })]);
    expect(report.repositories.map((entry) => entry.status)).toEqual(["created"]);
  });

  test("a reused task branch is never moved to the new base", async () => {
    const { remotes, root, workspaceRoot } = await createLifecycleWorkspace();
    const first = await createTaskWorktree(workspaceRoot, "keep", { repos: ["foods"] });
    const taskTip = await git(path.join(first.root, "repos", "foods"), ["rev-parse", "HEAD"]);
    await removeTaskWorktree(workspaceRoot, "keep");
    await pushCommitToRemote(root, remotes.foods, "landed upstream");

    const second = await createTaskWorktree(workspaceRoot, "keep", { repos: ["foods"] });

    expect(second.repositories.map((entry) => entry.status)).toEqual(["reused"]);
    expect(await git(path.join(second.root, "repos", "foods"), ["rev-parse", "HEAD"])).toBe(
      taskTip,
    );
  });

  test("the workspace-root task branch starts from the default branch, not the current one", async () => {
    const { workspaceRoot } = await createLifecycleWorkspace();
    const mainTip = await git(workspaceRoot, ["rev-parse", "main"]);
    await git(workspaceRoot, ["switch", "-c", "feature/local"]);
    await git(workspaceRoot, ["commit", "--allow-empty", "-m", "feature work"]);

    const report = await createTaskWorktree(workspaceRoot, "from-feature", { repos: ["foods"] });

    expect(await git(report.root, ["rev-parse", "HEAD"])).toBe(mainTip);
  });
});
