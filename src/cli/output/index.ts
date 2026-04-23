import { JsonRenderer } from "./json-renderer.js";
import { HumanRenderer, type HumanReportKind } from "./human-renderer.js";
import type { OutputFormat, Renderer } from "./renderer.js";

export type { OutputFormat, Renderer, RendererError, ErrorCode } from "./renderer.js";
export { SCHEMA_VERSION } from "./renderer.js";
export { JsonRenderer } from "./json-renderer.js";
export { HumanRenderer } from "./human-renderer.js";
export type { HumanReportKind } from "./human-renderer.js";
export { resolveFormat } from "./format.js";
export type { ResolveFormatOptions } from "./format.js";

export interface CreateRendererOptions {
  reportKind: HumanReportKind;
  color?: boolean;
}

export function createRenderer(format: OutputFormat, options: CreateRendererOptions): Renderer {
  if (format === "json") {
    return new JsonRenderer();
  }
  return new HumanRenderer(options.reportKind, { color: options.color ?? false });
}
