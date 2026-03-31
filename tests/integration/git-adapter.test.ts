import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execa } from "execa";
import { beforeEach, describe, expect, test } from "vitest";
import { GitAdapter } from "../../src/adapters/git/git-adapter.js";
import { createManagedTempDir } from "../utils/test-lifecycle.js";

let gitAdapter: GitAdapter;

describe("git adapter branch operations", () => {
  beforeEach(() => {
    gitAdapter = new GitAdapter();
  });

  test("initializes a workspace repository when metadata is missing", async () => {
    const root = await createManagedTempDir("git-adapter-workspace-init-");
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });

    const result = await gitAdapter.ensureWorkspaceRepository(workspaceRoot);

    expect(result).toBe("created");
    expect(existsSync(path.join(workspaceRoot, ".git"))).toBe(true);
    expect(await gitAdapter.hasGitMetadata(workspaceRoot)).toBe(true);
    expect((await readFile(path.join(workspaceRoot, ".git", "HEAD"), "utf8")).trim()).toBe(
      "ref: refs/heads/main",
    );
  });

  test("keeps an existing workspace repository unchanged", async () => {
    const root = await createManagedTempDir("git-adapter-workspace-existing-");
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    await execa("git", ["init", "--initial-branch=main"], { cwd: workspaceRoot });

    const result = await gitAdapter.ensureWorkspaceRepository(workspaceRoot);

    expect(result).toBe("unchanged");
    expect(existsSync(path.join(workspaceRoot, ".git"))).toBe(true);
  });

  test("does not initialize a workspace repository in dry-run mode", async () => {
    const root = await createManagedTempDir("git-adapter-workspace-dry-run-");
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });

    const result = await gitAdapter.ensureWorkspaceRepository(workspaceRoot, true);

    expect(result).toBe("created");
    expect(existsSync(path.join(workspaceRoot, ".git"))).toBe(false);
  });

  test("detects unborn workspace repositories", async () => {
    const root = await createManagedTempDir("git-adapter-workspace-unborn-");
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });

    expect(await gitAdapter.isUnbornRepository(workspaceRoot)).toBe(true);
    await execa("git", ["init", "--initial-branch=main"], { cwd: workspaceRoot });
    expect(await gitAdapter.isUnbornRepository(workspaceRoot)).toBe(true);
    await writeFile(path.join(workspaceRoot, "README.md"), "booted\n", "utf8");
    await execa("git", ["add", "README.md"], { cwd: workspaceRoot });
    await execa(
      "git",
      [
        "-c",
        "user.name=Test User",
        "-c",
        "user.email=test@example.invalid",
        "-c",
        "commit.gpgSign=false",
        "commit",
        "-m",
        "booted",
      ],
      { cwd: workspaceRoot },
    );
    expect(await gitAdapter.isUnbornRepository(workspaceRoot)).toBe(false);
  });

  test("checks out a tracked remote branch", async () => {
    const root = await createManagedTempDir("git-adapter-checkout-");
    const remote = await createBareRemoteRepo(root, "sample", {
      main: { "README.md": "main\n" },
      develop: { "README.md": "develop\n" },
    });
    const repoRoot = path.join(root, "repo");
    await execa("git", ["clone", remote, repoRoot]);

    const result = await gitAdapter.checkoutBranch(repoRoot, "develop");

    expect(result).toEqual({ branch: "develop", status: "updated" });
    expect(await gitAdapter.getCurrentBranch(repoRoot)).toBe("develop");
  });

  test("refuses to checkout another branch when the working tree is dirty", async () => {
    const root = await createManagedTempDir("git-adapter-checkout-dirty-");
    const remote = await createBareRemoteRepo(root, "sample", {
      main: { "README.md": "main\n" },
      develop: { "README.md": "develop\n" },
    });
    const repoRoot = path.join(root, "repo");
    await execa("git", ["clone", remote, repoRoot]);
    await writeFile(path.join(repoRoot, "README.md"), "dirty\n", "utf8");

    await expect(gitAdapter.checkoutBranch(repoRoot, "develop")).rejects.toThrow(
      "working tree is not clean",
    );
  });

  test("pulls the current branch from origin", async () => {
    const root = await createManagedTempDir("git-adapter-pull-");
    const remote = await createBareRemoteRepo(root, "sample", { main: { "README.md": "v1\n" } });
    const repoRoot = path.join(root, "repo");
    await execa("git", ["clone", remote, repoRoot]);

    await addCommitToBareRemote(root, remote, "main", "README.md", "v2\n", "Update main");

    const result = await gitAdapter.pullCurrentBranch(repoRoot);

    expect(result).toEqual({ branch: "main", status: "updated" });
    expect((await execa("git", ["show", "HEAD:README.md"], { cwd: repoRoot })).stdout).toBe("v2");
  });

  test("fails when pull cannot fast-forward cleanly", async () => {
    const root = await createManagedTempDir("git-adapter-pull-diverged-");
    const remote = await createBareRemoteRepo(root, "sample", { main: { "README.md": "v1\n" } });
    const repoRoot = path.join(root, "repo");
    const peerRoot = path.join(root, "peer");
    await execa("git", ["clone", remote, repoRoot]);
    await execa("git", ["clone", remote, peerRoot]);
    await configureGitIdentity(repoRoot);
    await configureGitIdentity(peerRoot);

    await writeFile(path.join(repoRoot, "README.md"), "local\n", "utf8");
    await execa("git", ["-c", "commit.gpgSign=false", "commit", "-am", "Local change"], {
      cwd: repoRoot,
    });

    await writeFile(path.join(peerRoot, "README.md"), "remote\n", "utf8");
    await execa("git", ["-c", "commit.gpgSign=false", "commit", "-am", "Remote change"], {
      cwd: peerRoot,
    });
    await execa("git", ["push", "origin", "main"], { cwd: peerRoot });

    await expect(gitAdapter.pullCurrentBranch(repoRoot)).rejects.toThrow("Git command failed");
  });

  test("rejects option-like branch names", async () => {
    const root = await createManagedTempDir("git-adapter-invalid-branch-");
    const remote = await createBareRemoteRepo(root, "sample", {
      main: { "README.md": "main\n" },
    });
    const repoRoot = path.join(root, "repo");
    await execa("git", ["clone", remote, repoRoot]);

    await expect(gitAdapter.checkoutBranch(repoRoot, "--help")).rejects.toThrow(
      "Invalid branch name",
    );
  });

  test("clones the full repository when sparse checkout is omitted", async () => {
    const root = await createManagedTempDir("git-adapter-full-clone-");
    const remote = await createBareRemoteRepo(root, "sample", {
      main: {
        "README.md": "main\n",
        "src/Secret.ts": "secret\n",
      },
    });
    const repoRoot = path.join(root, "repo");

    await gitAdapter.ensureRepository(
      repoRoot,
      {
        name: "sample",
        remote,
        branch: "main",
      },
      false,
    );

    expect(await gitAdapter.getCurrentBranch(repoRoot)).toBe("main");
    expect(await gitAdapter.hasGitMetadata(repoRoot)).toBe(true);
    expect(await gitAdapter.isClean(repoRoot)).toBe(true);
    expect(existsSync(path.join(repoRoot, ".git", "info", "sparse-checkout"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "README.md"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "src", "Secret.ts"))).toBe(true);
  });

  test("supports sparse exclude paths", async () => {
    const root = await createManagedTempDir("git-adapter-sparse-exclude-");
    const remote = await createBareRemoteRepo(root, "sample", {
      main: {
        "README.md": "main\n",
        "src/Secret.ts": "secret\n",
        "docs/Guide.md": "guide\n",
      },
    });
    const repoRoot = path.join(root, "repo");

    await gitAdapter.ensureRepository(
      repoRoot,
      {
        name: "sample",
        remote,
        branch: "main",
        sparse: {
          excludePaths: ["src/"],
        },
      },
      false,
    );

    expect(await gitAdapter.getCurrentBranch(repoRoot)).toBe("main");
    expect(existsSync(path.join(repoRoot, "README.md"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "docs", "Guide.md"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "src"))).toBe(false);
  });

  test("applies sparse excludes after sparse includes", async () => {
    const root = await createManagedTempDir("git-adapter-sparse-include-exclude-");
    const remote = await createBareRemoteRepo(root, "sample", {
      main: {
        "docs/Guide.md": "guide\n",
        "docs/Reference.md": "reference\n",
        "src/Public.ts": "public\n",
        "src/Secret.ts": "secret\n",
      },
    });
    const repoRoot = path.join(root, "repo");

    await gitAdapter.ensureRepository(
      repoRoot,
      {
        name: "sample",
        remote,
        branch: "main",
        sparse: {
          includePaths: ["docs/", "src/"],
          excludePaths: ["docs/Guide.md", "src/Secret.ts"],
        },
      },
      false,
    );

    expect(await gitAdapter.getCurrentBranch(repoRoot)).toBe("main");
    expect(existsSync(path.join(repoRoot, "docs", "Reference.md"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "docs", "Guide.md"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "src", "Public.ts"))).toBe(true);
    expect(existsSync(path.join(repoRoot, "src", "Secret.ts"))).toBe(false);
  });
});

async function createBareRemoteRepo(
  root: string,
  name: string,
  branches: Record<string, Record<string, string>>,
): Promise<string> {
  const branchNames = Object.keys(branches);
  const initialBranch = branchNames[0] ?? "main";
  const sourceRoot = path.join(root, `${name}-source`);
  const bareRoot = path.join(root, `${name}.git`);
  await mkdir(sourceRoot, { recursive: true });
  await execa("git", ["init", `--initial-branch=${initialBranch}`], { cwd: sourceRoot });
  await configureGitIdentity(sourceRoot);

  for (const [branchName, files] of branchNames.map(
    (branchName) => [branchName, branches[branchName] ?? {}] as const,
  )) {
    if (branchName !== initialBranch) {
      await execa("git", ["checkout", "-b", branchName], { cwd: sourceRoot });
    }

    for (const [relativePath, content] of Object.entries(files)) {
      const targetPath = path.join(sourceRoot, relativePath);
      await mkdir(path.dirname(targetPath), { recursive: true });
      await writeFile(targetPath, content, "utf8");
    }

    await execa("git", ["add", "."], { cwd: sourceRoot });
    await execa("git", ["-c", "commit.gpgSign=false", "commit", "-m", `Initial ${branchName}`], {
      cwd: sourceRoot,
    });
  }

  await execa("git", ["checkout", initialBranch], { cwd: sourceRoot });
  await execa("git", ["clone", "--bare", sourceRoot, bareRoot]);
  return bareRoot;
}

async function addCommitToBareRemote(
  root: string,
  remote: string,
  branchName: string,
  relativePath: string,
  content: string,
  commitMessage: string,
): Promise<void> {
  const cloneRoot = path.join(root, `push-${branchName}-${Date.now()}`);
  await execa("git", ["clone", remote, cloneRoot]);
  await configureGitIdentity(cloneRoot);
  await execa("git", ["checkout", branchName], { cwd: cloneRoot });
  await writeFile(path.join(cloneRoot, relativePath), content, "utf8");
  await execa("git", ["-c", "commit.gpgSign=false", "commit", "-am", commitMessage], {
    cwd: cloneRoot,
  });
  await execa("git", ["push", "origin", branchName], { cwd: cloneRoot });
}

async function configureGitIdentity(repoRoot: string): Promise<void> {
  await execa("git", ["config", "user.name", "Test User"], { cwd: repoRoot });
  await execa("git", ["config", "user.email", "test@example.invalid"], { cwd: repoRoot });
  await execa("git", ["config", "commit.gpgSign", "false"], { cwd: repoRoot });
}
