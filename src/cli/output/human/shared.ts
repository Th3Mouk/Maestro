import pc from "picocolors";
import type { ReportStatus } from "../../../report/types.js";

export interface HumanFormatContext {
  color: boolean;
}

type Formatter = (value: string) => string;

function identity(value: string): string {
  return value;
}

function pick(color: boolean, fn: Formatter): Formatter {
  return color ? fn : identity;
}

function statusLabel(status: ReportStatus, ctx: HumanFormatContext): string {
  const paint = pick(
    ctx.color,
    status === "ok" ? pc.green : status === "warning" ? pc.yellow : pc.red,
  );
  return paint(status);
}

export function paintStatus(
  value: string,
  tone: "ok" | "warning" | "error" | "neutral" | "dim",
  ctx: HumanFormatContext,
): string {
  if (!ctx.color) {
    return value;
  }
  switch (tone) {
    case "ok":
      return pc.green(value);
    case "warning":
      return pc.yellow(value);
    case "error":
      return pc.red(value);
    case "dim":
      return pc.dim(value);
    case "neutral":
    default:
      return value;
  }
}

export function dim(value: string, ctx: HumanFormatContext): string {
  return pick(ctx.color, pc.dim)(value);
}

export function bold(value: string, ctx: HumanFormatContext): string {
  return pick(ctx.color, pc.bold)(value);
}

export function renderIssues(
  issues: ReadonlyArray<{ code: string; message: string; path?: string }>,
  ctx: HumanFormatContext,
): string {
  if (issues.length === 0) {
    return "";
  }
  const lines = issues.map((issue) => {
    const suffix = issue.path ? ` ${dim(`(${issue.path})`, ctx)}` : "";
    return `  - ${bold(issue.code, ctx)}: ${issue.message}${suffix}`;
  });
  return `\nIssues:\n${lines.join("\n")}`;
}

export function summaryLine(
  command: string,
  status: ReportStatus,
  extras: string,
  ctx: HumanFormatContext,
): string {
  return `${bold(command, ctx)}: ${statusLabel(status, ctx)}${extras ? ` (${extras})` : ""}`;
}
