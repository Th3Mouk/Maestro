import pc from "picocolors";
import type { RuntimeName } from "../../../runtime/types.js";
import type { ReportStatus } from "../../../report/types.js";
import { statusToExitCode } from "../../exit-codes.js";
import { createRenderer, resolveFormat } from "../../output/index.js";
import type { HumanReportKind } from "../../output/index.js";
import type { ErrorCode, Renderer, RendererError } from "../../output/renderer.js";
import type { OutputOptionValues } from "../shared-options.js";

export function parseRuntimeNames(value?: string): RuntimeName[] | undefined {
  if (!value) {
    return undefined;
  }

  const supportedRuntimeNames: RuntimeName[] = ["codex", "claude-code", "opencode"];
  const runtimes = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const invalidRuntimeNames = runtimes.filter(
    (runtime): runtime is string => !supportedRuntimeNames.includes(runtime as RuntimeName),
  );
  if (invalidRuntimeNames.length > 0) {
    throw new Error(
      `Unsupported runtime(s): ${invalidRuntimeNames.join(", ")}. Supported values: ${supportedRuntimeNames.join(", ")}`,
    );
  }

  return runtimes.length > 0 ? Array.from(new Set(runtimes as RuntimeName[])) : undefined;
}

function rendererFromOptions(options: OutputOptionValues, reportKind: HumanReportKind): Renderer {
  const format = resolveFormat({
    formatFlag: options.format,
    jsonFlag: options.json,
    env: process.env,
    isTTY: Boolean(process.stdout.isTTY),
  });
  const color =
    options.color !== false && process.env.NO_COLOR === undefined && pc.isColorSupported;
  return createRenderer(format, { reportKind, color });
}

interface HasStatus {
  status: ReportStatus;
}

/**
 * Runs an action that produces a report, renders it via the resolved renderer,
 * and sets process.exitCode through {@link statusToExitCode}. Thrown errors are
 * routed through {@link Renderer.renderError} and mapped to exit code 1.
 */
export async function runReportAction<TReport extends HasStatus>(
  options: OutputOptionValues,
  reportKind: HumanReportKind,
  run: (renderer: Renderer) => Promise<TReport>,
): Promise<void> {
  let renderer: Renderer;
  try {
    renderer = rendererFromOptions(options, reportKind);
  } catch (error) {
    const fallback = createRenderer("json", { reportKind });
    fallback.renderError(
      {
        code: "UNEXPECTED",
        message: error instanceof Error ? error.message : String(error),
      },
      process.stderr,
    );
    process.exitCode = 1;
    return;
  }

  try {
    const report = await run(renderer);
    renderer.render(report, process.stdout);
    process.exitCode = statusToExitCode(report.status);
  } catch (error) {
    renderer.renderError(toRendererError(error), process.stderr);
    process.exitCode = 1;
  }
}

function toRendererError(error: unknown): RendererError {
  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const candidate = error as { code: unknown; message: unknown; details?: unknown };
    if (typeof candidate.code === "string" && typeof candidate.message === "string") {
      return {
        code: candidate.code as ErrorCode,
        message: candidate.message,
        ...(candidate.details && typeof candidate.details === "object"
          ? { details: candidate.details as Record<string, unknown> }
          : {}),
      };
    }
  }

  return {
    code: "UNEXPECTED",
    message: error instanceof Error ? error.message : String(error),
  };
}
