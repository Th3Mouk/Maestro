import { JsonRenderer } from "./json-renderer.js";
import type { OutputFormat, Renderer } from "./renderer.js";

export type { OutputFormat, Renderer, RendererError, ErrorCode } from "./renderer.js";
export { SCHEMA_VERSION } from "./renderer.js";
export { JsonRenderer } from "./json-renderer.js";
export { resolveFormat } from "./format.js";
export type { ResolveFormatOptions } from "./format.js";

export function createRenderer(format: OutputFormat): Renderer {
  if (format === "json") {
    return new JsonRenderer();
  }

  // TODO(phase-4b): instantiate HumanRenderer here.
  throw new Error(
    `Output format "${format}" is not yet implemented. Only "json" is available in Phase 4a.`,
  );
}
