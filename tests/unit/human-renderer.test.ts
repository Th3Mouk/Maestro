import { describe, expect, test } from "vitest";
import { HumanRenderer } from "../../src/cli/output/human-renderer.js";
import type {
  BootstrapReport,
  DoctorReport,
  InstallReport,
  RepoListReport,
  TaskWorktreeReport,
  WorkspaceGitReport,
  WorktreeListReport,
  WorktreeRemoveReport,
} from "../../src/report/types.js";

function capture(renderFn: (stream: NodeJS.WritableStream) => void): string {
  let buffer = "";
  const stream = {
    write: (chunk: string | Uint8Array) => {
      buffer += typeof chunk === "string" ? chunk : chunk.toString();
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  renderFn(stream);
  return buffer;
}

// Returns the single table row containing `marker`, so assertions can check that a value is
// bound to the *right* row instead of merely appearing somewhere in the output — a table with N
// rows swapped would still contain every value, just on the wrong line.
function rowContaining(output: string, marker: string): string {
  const row = output.split("\n").find((line) => line.includes(marker));
  expect(row).toBeDefined();
  return row ?? "";
}

describe("HumanRenderer", () => {
  test("formats a RepoListReport with a table and summary", () => {
    const report: RepoListReport = {
      status: "ok",
      workspace: "/tmp/workspace",
      repositories: [
        {
          name: "api",
          branch: "main",
          remote: "git@example.com:api.git",
          path: "/tmp/workspace/repos/api",
          installed: true,
        },
        {
          name: "web",
          branch: "develop",
          remote: "git@example.com:web.git",
          path: "/tmp/workspace/repos/web",
          installed: false,
        },
      ],
      issues: [],
    };
    const renderer = new HumanRenderer("repo-list", { color: false });
    const output = capture((stream) => renderer.render(report, stream));

    expect(output).toContain("repo list: ok");
    expect(output).toContain("2 repositories, 1 installed");
    expect(output).toContain("api");
    expect(output).toContain("main");
    expect(output).toContain("web");
    expect(output).toContain("yes");
    expect(output).toContain("no");
  });

  test("formats an empty WorktreeListReport with the no-op sentinel", () => {
    const report: WorktreeListReport = {
      status: "ok",
      workspace: "/tmp/workspace",
      worktrees: [],
      issues: [],
    };
    const renderer = new HumanRenderer("worktree-list", { color: false });
    const output = capture((stream) => renderer.render(report, stream));

    expect(output).toContain("worktree list: ok");
    expect(output).toContain("0 worktrees");
    expect(output).toContain("nothing to do");
  });

  test("formats a WorktreeListReport with a table row per worktree", () => {
    const report: WorktreeListReport = {
      status: "ok",
      workspace: "/tmp/workspace",
      worktrees: [
        { name: "feature-auth", root: "/tmp/worktrees/wt-1", createdAt: "2026-09-01T10:00:00Z" },
        {
          name: "bugfix-timeout",
          root: "/tmp/worktrees/wt-2",
          createdAt: "2026-09-05T14:30:00Z",
        },
      ],
      issues: [
        { code: "WORKTREE_METADATA_MISSING", message: "metadata absent for bugfix-timeout" },
      ],
    };
    const renderer = new HumanRenderer("worktree-list", { color: false });
    const output = capture((stream) => renderer.render(report, stream));

    expect(output).toContain("worktree list: ok");
    expect(output).toContain("2 worktrees");
    expect(output).not.toContain("nothing to do");
    expect(output).toContain("Name");
    expect(output).toContain("Root");
    expect(output).toContain("Created");

    const firstRow = rowContaining(output, "feature-auth");
    expect(firstRow).toContain("wt-1");
    expect(firstRow).toContain("2026-09-01T10:00:00Z");
    expect(firstRow).not.toContain("wt-2");

    const secondRow = rowContaining(output, "bugfix-timeout");
    expect(secondRow).toContain("wt-2");
    expect(secondRow).toContain("2026-09-05T14:30:00Z");
    expect(secondRow).not.toContain("wt-1");

    expect(output).toContain("WORKTREE_METADATA_MISSING");
  });

  test("formats a BootstrapReport with a distinct failed state per repository", () => {
    const report: BootstrapReport = {
      status: "warning",
      workspace: "repro",
      repositories: [
        { name: "demo", commands: ["sh -c 'echo BOOTSTRAP_RAN; exit 3'"], state: "failed" },
        { name: "other", commands: ["npm ci"], state: "executed" },
        { name: "skipped-one", commands: [], state: "skipped" },
      ],
      issues: [
        {
          code: "BOOTSTRAP_COMMAND_FAILED",
          message: "Bootstrap command failed for demo: exit code 3",
          path: "/tmp/ws/repos/demo",
        },
      ],
    };
    const renderer = new HumanRenderer("bootstrap", { color: false });
    const output = capture((stream) => renderer.render(report, stream));

    expect(output).toContain("repo bootstrap: warning");
    expect(output).toContain("1 executed, 1 skipped, 1 failed, 1 issues");
    expect(output).toContain("failed");
    expect(output).toContain("BOOTSTRAP_COMMAND_FAILED");
    // A repository whose bootstrap command failed must never be reported as "executed".
    expect(rowContaining(output, "demo")).not.toContain("executed");
  });

  test("formats a DoctorReport by severity and bolds codes", () => {
    const report: DoctorReport = {
      status: "warning",
      workspace: "/tmp/workspace",
      issues: [
        { code: "REPO_MISSING", message: "repos/api is absent", path: "repos/api" },
        { code: "WARN_DRIFT", message: "lockfile drifted" },
      ],
    };
    const renderer = new HumanRenderer("doctor", { color: false });
    const output = capture((stream) => renderer.render(report, stream));

    expect(output).toContain("workspace doctor: warning");
    expect(output).toContain("ERROR");
    expect(output).toContain("WARNING");
    expect(output).toContain("REPO_MISSING");
    expect(output).toContain("repos/api is absent");
    expect(output).toContain("WARN_DRIFT");
  });

  test("formats an InstallReport with the no-op sentinel when there are no repositories", () => {
    const report: InstallReport = {
      status: "ok",
      workspace: "/tmp/workspace",
      actions: [],
      repositories: [],
      projectedRuntimes: [],
      issues: [{ code: "MANIFEST_INVALID", message: "manifest missing" }],
    };
    const renderer = new HumanRenderer("install", { color: false });
    const output = capture((stream) => renderer.render(report, stream));

    expect(output).toContain("workspace install: ok");
    expect(output).toContain("0 repositories, 1 issues");
    expect(output).toContain("(no repositories)");
    expect(output).toContain("MANIFEST_INVALID");
    expect(output).not.toContain("Actions:");
  });

  test("formats an InstallReport with a status table, actions and projected runtimes", () => {
    const report: InstallReport = {
      status: "ok",
      workspace: "/tmp/workspace",
      actions: ["clone", "bootstrap"],
      repositories: [
        { name: "api", status: "created", path: "/tmp/workspace/repos/api" },
        { name: "web", status: "updated", path: "/tmp/workspace/repos/web" },
        { name: "docs", status: "unchanged", path: "/tmp/workspace/repos/docs" },
      ],
      projectedRuntimes: ["claude-code"],
      issues: [],
    };
    const renderer = new HumanRenderer("install", { color: false });
    const output = capture((stream) => renderer.render(report, stream));

    expect(output).toContain("workspace install: ok");
    expect(output).toContain("3 repositories, 0 issues");
    expect(output).toContain("Actions: clone, bootstrap");
    expect(output).toContain("Projected runtimes: claude-code");
    expect(rowContaining(output, "api")).toContain("created");
    expect(rowContaining(output, "web")).toContain("updated");
    expect(rowContaining(output, "docs")).toContain("unchanged");
    expect(output).not.toContain("Issues:");
  });

  test("formats a WorkspaceGitReport with the no-op sentinel when there are no repositories", () => {
    const report: WorkspaceGitReport = {
      status: "ok",
      workspace: "/tmp/workspace",
      command: "pull",
      repositories: [],
      issues: [],
    };
    const renderer = new HumanRenderer("workspace-git", { color: false });
    const output = capture((stream) => renderer.render(report, stream));

    expect(output).toContain("repo git pull: ok");
    expect(output).toContain("0 updated, 0 failed, 0 total");
    expect(output).toContain("ok - nothing to do");
  });

  test("formats a WorkspaceGitReport with per-repository status and an optional message", () => {
    const report: WorkspaceGitReport = {
      status: "warning",
      workspace: "/tmp/workspace",
      command: "sync",
      repositories: [
        { name: "api", path: "/tmp/workspace/repos/api", branch: "main", status: "updated" },
        {
          name: "web",
          path: "/tmp/workspace/repos/web",
          branch: "develop",
          status: "failed",
          message: "merge conflict",
        },
        { name: "docs", path: "/tmp/workspace/repos/docs", branch: "main", status: "unchanged" },
      ],
      issues: [
        {
          code: "GIT_OPERATION_FAILED",
          message: "sync failed for web",
          path: "/tmp/workspace/repos/web",
        },
      ],
    };
    const renderer = new HumanRenderer("workspace-git", { color: false });
    const output = capture((stream) => renderer.render(report, stream));

    expect(output).toContain("repo git sync: warning");
    expect(output).toContain("1 updated, 1 failed, 3 total");
    expect(rowContaining(output, "api")).toContain("updated");
    const webRow = rowContaining(output, "web");
    expect(webRow).toContain("develop");
    expect(webRow).toContain("failed");
    expect(webRow).toContain("merge conflict");
    expect(rowContaining(output, "docs")).toContain("unchanged");
    expect(output).toContain("GIT_OPERATION_FAILED");
  });

  test("formats a TaskWorktreeReport with the no-op sentinel when there are no repositories", () => {
    const report: TaskWorktreeReport = {
      status: "ok",
      workspace: "/tmp/workspace",
      name: "feature-x",
      root: "/tmp/worktrees/feature-x",
      repositories: [],
      issues: [],
    };
    const renderer = new HumanRenderer("worktree-create", { color: false });
    const output = capture((stream) => renderer.render(report, stream));

    expect(output).toContain("worktree create feature-x: ok");
    expect(output).toContain("0 repositories, 0 issues");
    expect(output).toContain("/tmp/worktrees/feature-x");
    expect(output).toContain("ok - nothing to do");
  });

  test("formats a TaskWorktreeReport with a status table per repository", () => {
    const report: TaskWorktreeReport = {
      status: "warning",
      workspace: "/tmp/workspace",
      name: "feature-x",
      root: "/tmp/worktrees/feature-x",
      repositories: [
        {
          name: "api",
          path: "/tmp/worktrees/feature-x/api",
          branch: "feature-x",
          status: "created",
        },
        {
          name: "web",
          path: "/tmp/worktrees/feature-x/web",
          branch: "feature-x",
          status: "unchanged",
        },
      ],
      issues: [
        {
          code: "WORKTREE_METADATA_MISSING",
          message: "metadata absent for web",
          path: "/tmp/worktrees/feature-x/web",
        },
      ],
    };
    const renderer = new HumanRenderer("worktree-create", { color: false });
    const output = capture((stream) => renderer.render(report, stream));

    expect(output).toContain("worktree create feature-x: warning");
    expect(output).toContain("2 repositories, 1 issues");
    expect(rowContaining(output, "api")).toContain("created");
    expect(rowContaining(output, "web")).toContain("unchanged");
    expect(output).toContain("WORKTREE_METADATA_MISSING");
  });

  test("formats a WorktreeRemoveReport with the no-op sentinel when there are no repositories", () => {
    const report: WorktreeRemoveReport = {
      status: "ok",
      workspace: "/tmp/workspace",
      name: "feature-x",
      root: "/tmp/worktrees/feature-x",
      repositories: [],
      workspaceRootStatus: "removed",
      issues: [],
    };
    const renderer = new HumanRenderer("worktree-remove", { color: false });
    const output = capture((stream) => renderer.render(report, stream));

    expect(output).toContain("worktree remove feature-x: ok");
    expect(output).toContain("0 removed, 0 failed, root removed");
    expect(output).toContain("ok - nothing to do");
  });

  test("formats a WorktreeRemoveReport with a distinct status per repository", () => {
    const report: WorktreeRemoveReport = {
      status: "error",
      workspace: "/tmp/workspace",
      name: "feature-x",
      root: "/tmp/worktrees/feature-x",
      repositories: [
        { name: "api", path: "/tmp/worktrees/feature-x/api", status: "removed" },
        {
          name: "web",
          path: "/tmp/worktrees/feature-x/web",
          status: "failed",
          message: "dirty working tree",
        },
        { name: "docs", path: "/tmp/worktrees/feature-x/docs", status: "missing" },
        { name: "extra", path: "/tmp/worktrees/feature-x/extra", status: "skipped" },
      ],
      workspaceRootStatus: "failed",
      issues: [
        {
          code: "WORKTREE_NOT_FOUND",
          message: "root missing",
          path: "/tmp/worktrees/feature-x",
        },
      ],
    };
    const renderer = new HumanRenderer("worktree-remove", { color: false });
    const output = capture((stream) => renderer.render(report, stream));

    expect(output).toContain("worktree remove feature-x: error");
    expect(output).toContain("1 removed, 1 failed, root failed");
    expect(rowContaining(output, "api")).toContain("removed");
    const webRow = rowContaining(output, "web");
    expect(webRow).toContain("failed");
    expect(webRow).toContain("dirty working tree");
    expect(rowContaining(output, "docs")).toContain("missing");
    expect(rowContaining(output, "extra")).toContain("skipped");
    expect(output).toContain("WORKTREE_NOT_FOUND");
  });

  test("renderError writes message, code and details without a stack", () => {
    const renderer = new HumanRenderer("repo-list", { color: false });
    let buffer = "";
    const stream = {
      write: (chunk: string | Uint8Array) => {
        buffer += typeof chunk === "string" ? chunk : chunk.toString();
        return true;
      },
    } as unknown as NodeJS.WritableStream;
    renderer.renderError(
      {
        code: "WORKSPACE_NOT_FOUND",
        message: "missing workspace",
        details: { path: "/tmp/missing" },
      },
      stream,
    );

    expect(buffer).toContain("Error: missing workspace");
    expect(buffer).toContain("Code: WORKSPACE_NOT_FOUND");
    expect(buffer).toContain("path: /tmp/missing");
    expect(buffer).not.toContain("at ");
  });
});
