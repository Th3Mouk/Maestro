import type { Renderer, RendererError } from "./renderer.js";
import { SCHEMA_VERSION } from "./renderer.js";

export class JsonRenderer implements Renderer {
  render(report: unknown, stdout: NodeJS.WritableStream): void {
    const envelope = { data: report, schemaVersion: SCHEMA_VERSION };
    stdout.write(`${JSON.stringify(envelope, null, 2)}\n`);
  }

  renderError(error: RendererError, stderr: NodeJS.WritableStream): void {
    const envelope = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details !== undefined ? { details: error.details } : {}),
      },
      schemaVersion: SCHEMA_VERSION,
    };
    stderr.write(`${JSON.stringify(envelope, null, 2)}\n`);
  }
}
