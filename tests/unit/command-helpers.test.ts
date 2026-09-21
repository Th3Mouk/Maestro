import { afterEach, describe, expect, test, vi } from "vitest";
import {
  parseRuntimeNames,
  runReportAction,
} from "../../src/cli/program/commands/command-helpers.js";
import type { HumanReportKind } from "../../src/cli/output/human-renderer.js";
import type { OutputFormat, Renderer, RendererError } from "../../src/cli/output/renderer.js";

const { createRenderer } = vi.hoisted(() => ({
  createRenderer:
    vi.fn<
      (format: OutputFormat, options: { reportKind: HumanReportKind; color?: boolean }) => Renderer
    >(),
}));

vi.mock("../../src/cli/output/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/cli/output/index.js")>();
  return { ...actual, createRenderer };
});

function makeFakeRenderer(): Renderer {
  return {
    render: vi.fn<(report: unknown, stdout: NodeJS.WritableStream) => void>(),
    renderError: vi.fn<(error: RendererError, stderr: NodeJS.WritableStream) => void>(),
  };
}

describe("parseRuntimeNames", () => {
  test("returns undefined when no value is passed", () => {
    expect(parseRuntimeNames(undefined)).toBeUndefined();
  });

  test("returns undefined for an empty or whitespace/comma-only value", () => {
    expect(parseRuntimeNames("")).toBeUndefined();
    expect(parseRuntimeNames(" , , ")).toBeUndefined();
  });

  test("trims entries and deduplicates them", () => {
    expect(parseRuntimeNames("claude-code, standard ,claude-code")).toEqual([
      "claude-code",
      "standard",
    ]);
  });

  test("throws listing every unsupported runtime and the supported values", () => {
    expect(() => parseRuntimeNames("claude-code,bogus,other")).toThrow(
      "Unsupported runtime(s): bogus, other. Supported values: standard, claude-code",
    );
  });
});

describe("runReportAction", () => {
  afterEach(() => {
    process.exitCode = undefined;
  });

  test("renders the resolved report and maps an ok status to exit code 0", async () => {
    const renderer = makeFakeRenderer();
    createRenderer.mockReturnValue(renderer);
    const report = { status: "ok" as const, workspace: "/tmp/workspace", issues: [] };

    await runReportAction({}, "doctor", async () => report);

    const [renderedReport, renderedStream] = vi.mocked(renderer.render).mock.calls[0] ?? [];
    expect(renderedReport).toEqual(report);
    expect(renderedStream).toBe(process.stdout);
    expect(renderer.renderError).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  test("maps a warning status to exit code 0", async () => {
    createRenderer.mockReturnValue(makeFakeRenderer());

    await runReportAction({}, "doctor", async () => ({
      status: "warning" as const,
      workspace: "/tmp/workspace",
      issues: [],
    }));

    expect(process.exitCode).toBe(0);
  });

  test("maps an error status to exit code 1", async () => {
    createRenderer.mockReturnValue(makeFakeRenderer());

    await runReportAction({}, "doctor", async () => ({
      status: "error" as const,
      workspace: "/tmp/workspace",
      issues: [{ code: "REPO_MISSING", message: "repos/api is absent" }],
    }));

    expect(process.exitCode).toBe(1);
  });

  test("passes --no-color through to the renderer regardless of TTY/env detection", async () => {
    createRenderer.mockReturnValue(makeFakeRenderer());

    await runReportAction({ color: false }, "doctor", async () => ({
      status: "ok" as const,
      workspace: "/tmp/workspace",
      issues: [],
    }));

    expect(createRenderer).toHaveBeenCalledWith(expect.any(String), {
      reportKind: "doctor",
      color: false,
    });
  });

  test("routes a renderer-error-shaped rejection through unchanged, details included", async () => {
    const renderer = makeFakeRenderer();
    createRenderer.mockReturnValue(renderer);
    const reason = {
      code: "REPO_DIRTY",
      message: "uncommitted changes",
      details: { path: "/tmp/repo" },
    };

    await runReportAction({}, "doctor", () => Promise.reject(reason));

    const [renderedError, renderedStream] = vi.mocked(renderer.renderError).mock.calls[0] ?? [];
    expect(renderer.render).not.toHaveBeenCalled();
    expect(renderedError).toEqual(reason);
    expect(renderedStream).toBe(process.stderr);
    expect(process.exitCode).toBe(1);
  });

  test("drops a non-object details value from a renderer-error-shaped rejection", async () => {
    const renderer = makeFakeRenderer();
    createRenderer.mockReturnValue(renderer);

    await runReportAction({}, "doctor", () =>
      Promise.reject({
        code: "REPO_DIRTY",
        message: "uncommitted changes",
        details: "not an object",
      }),
    );

    const [renderedError] = vi.mocked(renderer.renderError).mock.calls[0] ?? [];
    expect(renderedError).toEqual({ code: "REPO_DIRTY", message: "uncommitted changes" });
  });

  test("falls through to UNEXPECTED when code/message exist but aren't strings", async () => {
    const renderer = makeFakeRenderer();
    createRenderer.mockReturnValue(renderer);

    await runReportAction({}, "doctor", () => Promise.reject({ code: 123, message: "boom" }));

    const [renderedError] = vi.mocked(renderer.renderError).mock.calls[0] ?? [];
    expect(renderedError).toEqual({ code: "UNEXPECTED", message: "[object Object]" });
  });

  test("maps a plain Error rejection to an UNEXPECTED renderer error using its message", async () => {
    const renderer = makeFakeRenderer();
    createRenderer.mockReturnValue(renderer);

    await runReportAction({}, "doctor", () => Promise.reject(new Error("disk full")));

    const [renderedError] = vi.mocked(renderer.renderError).mock.calls[0] ?? [];
    expect(renderedError).toEqual({ code: "UNEXPECTED", message: "disk full" });
    expect(process.exitCode).toBe(1);
  });

  test("maps a non-Error rejection to an UNEXPECTED renderer error via String()", async () => {
    const renderer = makeFakeRenderer();
    createRenderer.mockReturnValue(renderer);

    await runReportAction({}, "doctor", () => Promise.reject("just a string"));

    const [renderedError] = vi.mocked(renderer.renderError).mock.calls[0] ?? [];
    expect(renderedError).toEqual({ code: "UNEXPECTED", message: "just a string" });
  });

  test("falls back to a fresh JSON renderer when the options themselves are invalid, without invoking run", async () => {
    const renderer = makeFakeRenderer();
    createRenderer.mockReturnValue(renderer);
    // Never invoked (renderer creation fails first), so it needs no implementation.
    const run = vi.fn<() => Promise<{ status: "ok"; workspace: string; issues: unknown[] }>>();

    await runReportAction({ format: "yaml" }, "doctor", run);

    expect(run).not.toHaveBeenCalled();
    expect(createRenderer).toHaveBeenCalledWith("json", { reportKind: "doctor" });
    const [renderedError, renderedStream] = vi.mocked(renderer.renderError).mock.calls[0] ?? [];
    expect(renderedError).toEqual({
      code: "UNEXPECTED",
      message: 'Invalid output format "yaml" (from --format). Supported values: human, json.',
    });
    expect(renderedStream).toBe(process.stderr);
    expect(process.exitCode).toBe(1);
  });
});
