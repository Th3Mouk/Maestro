export type OutputFormat = "human" | "json";

export type ErrorCode =
  | "WORKSPACE_NOT_FOUND"
  | "WORKSPACE_LOCKED"
  | "REPO_MISSING"
  | "REPO_DIRTY"
  | "WORKTREE_NOT_FOUND"
  | "WORKTREE_METADATA_MISSING"
  | "GIT_OPERATION_FAILED"
  | "MANIFEST_INVALID"
  | "BOOTSTRAP_FAILED"
  | "PERMISSION_DENIED"
  | "UNEXPECTED";

export interface RendererError {
  code: ErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface Renderer {
  render(report: unknown, stdout: NodeJS.WritableStream): void;
  renderError(error: RendererError, stderr: NodeJS.WritableStream): void;
}

export const SCHEMA_VERSION = 1 as const;
