import { describe, expect, test } from "vitest";
import { HumanRenderer } from "../../src/cli/output/human-renderer.js";
import type {
  BootstrapReport,
  DoctorReport,
  RepoListReport,
  WorktreeListReport,
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
    const demoRow = output.split("\n").find((line) => line.includes("demo"));
    expect(demoRow).toBeDefined();
    expect(demoRow).not.toContain("executed");
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
