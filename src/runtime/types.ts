import type { ResolvedWorkspace } from "../workspace/types.js";

export type RuntimeName = "standard" | "claude-code";
export const supportedRuntimeNames = [
  "standard",
  "claude-code",
] as const satisfies ReadonlyArray<RuntimeName>;

export interface RuntimeProjectionContext {
  workspaceRoot: string;
  resolvedWorkspace: ResolvedWorkspace;
}

export interface RuntimeProjector {
  name: RuntimeName | string;
  project(context: RuntimeProjectionContext): Promise<void>;
}

export interface RuntimeProjectorRegistry {
  register(projector: RuntimeProjector): void;
  list(): RuntimeProjector[];
}
