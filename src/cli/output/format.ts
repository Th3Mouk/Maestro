import type { OutputFormat } from "./renderer.js";

export interface ResolveFormatOptions {
  formatFlag?: string;
  jsonFlag?: boolean;
  env?: NodeJS.ProcessEnv;
  isTTY?: boolean;
}

const VALID_FORMATS: readonly OutputFormat[] = ["human", "json"];

function validateFormat(value: string, source: string): OutputFormat {
  if ((VALID_FORMATS as readonly string[]).includes(value)) {
    return value as OutputFormat;
  }
  throw new Error(
    `Invalid output format "${value}" (from ${source}). Supported values: ${VALID_FORMATS.join(", ")}.`,
  );
}

export function resolveFormat(options: ResolveFormatOptions = {}): OutputFormat {
  // Precedence: --json > --format > MAESTRO_FORMAT env > TTY default.
  if (options.jsonFlag === true) {
    return "json";
  }

  if (options.formatFlag !== undefined) {
    return validateFormat(options.formatFlag, "--format");
  }

  const envValue = options.env?.MAESTRO_FORMAT;
  if (envValue !== undefined && envValue !== "") {
    return validateFormat(envValue, "MAESTRO_FORMAT");
  }

  // TODO(phase-4b): return options.isTTY ? "human" : "json";
  // Phase 4a keeps JSON as the default on every invocation to preserve
  // existing behavior. The human renderer lands in Phase 4b.
  return "json";
}
