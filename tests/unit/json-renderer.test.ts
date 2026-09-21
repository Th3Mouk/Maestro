import { describe, expect, test } from "vitest";
import { JsonRenderer } from "../../src/cli/output/json-renderer.js";

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

describe("JsonRenderer", () => {
  test("render wraps the report in a data/schemaVersion envelope", () => {
    const renderer = new JsonRenderer();
    const report = { status: "ok", workspace: "/tmp/workspace" };
    const output = capture((stream) => renderer.render(report, stream));

    expect(JSON.parse(output)).toEqual({ data: report, schemaVersion: 1 });
    expect(output.endsWith("\n")).toBe(true);
  });

  test("renderError omits the details key when none is given", () => {
    const renderer = new JsonRenderer();
    const output = capture((stream) =>
      renderer.renderError({ code: "WORKSPACE_NOT_FOUND", message: "missing workspace" }, stream),
    );
    const parsed = JSON.parse(output);

    expect(parsed).toEqual({
      error: { code: "WORKSPACE_NOT_FOUND", message: "missing workspace" },
      schemaVersion: 1,
    });
    expect(parsed.error).not.toHaveProperty("details");
  });

  test("renderError includes details when provided", () => {
    const renderer = new JsonRenderer();
    const output = capture((stream) =>
      renderer.renderError(
        {
          code: "REPO_DIRTY",
          message: "uncommitted changes",
          details: { path: "/tmp/repo" },
        },
        stream,
      ),
    );

    expect(JSON.parse(output)).toEqual({
      error: {
        code: "REPO_DIRTY",
        message: "uncommitted changes",
        details: { path: "/tmp/repo" },
      },
      schemaVersion: 1,
    });
  });
});
