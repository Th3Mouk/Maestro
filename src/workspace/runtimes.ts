import { runtimeSupports, supportedRuntimeNames, type RuntimeName } from "../runtime/types.js";
import { defaultRuntimeProjectionMode } from "./schema.js";
import type {
  AssetProjection,
  ResolvedRuntimeProjection,
  ResolvedWorkspace,
  RuntimeConfig,
  RuntimeProjectionMode,
  WorkspaceManifest,
} from "./types.js";

/**
 * The canonical layout applied when a manifest omits `spec.runtimes` entirely: skills in
 * `.agents/skills/` and `.claude/skills/`, workflows in `.claude/workflows/`, no agents.
 */
export const canonicalRuntimes: NonNullable<WorkspaceManifest["spec"]["runtimes"]> = {
  standard: { enabled: true },
  "claude-code": { enabled: true },
};

export function normalizeRuntimes(manifest: WorkspaceManifest): ResolvedWorkspace["runtimes"] {
  const declared = manifest.spec.runtimes ?? canonicalRuntimes;
  const runtimes: ResolvedWorkspace["runtimes"] = {};
  for (const runtime of supportedRuntimeNames) {
    const config = declared[runtime] as RuntimeConfig | undefined;
    if (!config || config.enabled === false) {
      continue;
    }
    runtimes[runtime] = resolveRuntimeProjection(runtime, config);
  }
  return runtimes;
}

function resolveRuntimeProjection(
  runtime: RuntimeName,
  config: RuntimeConfig,
): ResolvedRuntimeProjection {
  const defaultMode = config.projectionMode ?? defaultRuntimeProjectionMode;
  const projection: ResolvedRuntimeProjection = {};

  if (runtimeSupports(runtime, "skills")) {
    const skills = resolveAsset(config.skills, defaultMode, true);
    if (skills) {
      const strategy = typeof config.skills === "object" ? config.skills.strategy : undefined;
      projection.skills = {
        ...skills,
        strategy: runtime === "claude-code" ? (strategy ?? "symlink") : "copy",
      };
    }
  }

  const agents = resolveAsset(config.agents, defaultMode, false);
  if (agents) {
    projection.agents = agents;
  }

  if (runtimeSupports(runtime, "workflows")) {
    const workflows = resolveAsset(config.workflows, defaultMode, true);
    if (workflows) {
      projection.workflows = workflows;
    }
  }

  return projection;
}

function resolveAsset(
  value: boolean | { mode?: RuntimeProjectionMode } | undefined,
  defaultMode: RuntimeProjectionMode,
  enabledByDefault: boolean,
): AssetProjection | undefined {
  if (value === false || (value === undefined && !enabledByDefault)) {
    return undefined;
  }

  return { mode: (typeof value === "object" ? value.mode : undefined) ?? defaultMode };
}
