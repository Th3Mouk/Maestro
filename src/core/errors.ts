import type { ReportStatus } from "../report/types.js";

interface MaestroErrorOptions {
  code: string;
  message: string;
  path?: string;
  cause?: unknown;
}

export class MaestroError extends Error {
  readonly code: string;
  readonly path?: string;

  constructor(options: MaestroErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "MaestroError";
    this.code = options.code;
    this.path = options.path;
  }
}

export function errorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const messages = new Set<string>();
  let current: unknown = error;
  while (current instanceof Error) {
    if (current.message.trim().length > 0) {
      messages.add(current.message);
    }
    current = current.cause;
  }

  if (messages.size === 0) {
    return error.name;
  }

  return Array.from(messages).join(": ");
}

export function escalateStatus(current: ReportStatus, candidate: ReportStatus): ReportStatus {
  const rank: Record<ReportStatus, number> = {
    ok: 0,
    warning: 1,
    error: 2,
  };
  return rank[candidate] > rank[current] ? candidate : current;
}
