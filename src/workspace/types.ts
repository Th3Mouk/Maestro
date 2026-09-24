import type {
  ConflictStrategy as ConflictStrategyFromSchema,
  DevcontainerExecution as DevcontainerExecutionFromSchema,
  NameSelection as NameSelectionFromSchema,
  PackManifest as PackManifestFromSchema,
  PackRef as PackRefFromSchema,
  PolicyRef as PolicyRefFromSchema,
  RepositoryBootstrap as RepositoryBootstrapFromSchema,
  RepositoryPermissions as RepositoryPermissionsFromSchema,
  RepositoryRef as RepositoryRefFromSchema,
  RepositorySparse as RepositorySparseFromSchema,
  RuntimeAgentSelection as RuntimeAgentSelectionFromSchema,
  RuntimeConfig as RuntimeConfigFromSchema,
  RuntimeProjectionMode as RuntimeProjectionModeFromSchema,
  SkillProjectionStrategy as SkillProjectionStrategyFromSchema,
  WorkspaceExecution as WorkspaceExecutionFromSchema,
  WorkspaceDescriptor as WorkspaceDescriptorFromSchema,
  WorkspaceLockfile as WorkspaceLockfileFromSchema,
  WorkspaceManifest as WorkspaceManifestFromSchema,
  WorkspacePlugins as WorkspacePluginsFromSchema,
  WorkspaceState as WorkspaceStateFromSchema,
  WorktreeExecution as WorktreeExecutionFromSchema,
} from "./schema.js";
import type { RuntimeName } from "../runtime/types.js";

export type RuntimeConfig = RuntimeConfigFromSchema;
export type RuntimeProjectionMode = RuntimeProjectionModeFromSchema;
export type SkillProjectionStrategy = SkillProjectionStrategyFromSchema;
export type PackRef = PackRefFromSchema;
export type PolicyRef = PolicyRefFromSchema;
export type RepositoryPermissions = RepositoryPermissionsFromSchema;
export type RepositoryBootstrap = RepositoryBootstrapFromSchema;
export type RepositorySparse = RepositorySparseFromSchema;
export type RepositoryRef = RepositoryRefFromSchema;
export type WorkspacePlugins = WorkspacePluginsFromSchema;
export type RuntimeAgentSelection = RuntimeAgentSelectionFromSchema;
export type NameSelection = NameSelectionFromSchema;
export type ConflictStrategy = ConflictStrategyFromSchema;
export type DevcontainerExecution = DevcontainerExecutionFromSchema;
export type WorktreeExecution = WorktreeExecutionFromSchema;
export type WorkspaceExecution = WorkspaceExecutionFromSchema;
export type WorkspaceDescriptor = WorkspaceDescriptorFromSchema;
export type WorkspaceManifest = WorkspaceManifestFromSchema;
export type PackManifest = PackManifestFromSchema;
export type WorkspaceLockfile = WorkspaceLockfileFromSchema;
export type WorkspaceState = WorkspaceStateFromSchema;

export interface PackResolution {
  ref: PackRef;
  root: string;
  manifest: PackManifest;
}

export interface ResolvedAgent {
  name: string;
  runtime: RuntimeName;
  source: "override" | "workspace" | "pack" | "default";
  filePath?: string;
  content: string;
  extension: AgentFileExtension;
}

export type AgentFileExtension = "agent.md" | "toml" | "md" | "json";

export interface ResolvedSkill {
  name: string;
  source: "override" | "workspace" | "pack";
  root: string;
}

export interface ResolvedWorkflow {
  name: string;
  source: "override" | "workspace" | "pack";
  filePath: string;
}

export interface AssetProjection {
  mode: RuntimeProjectionMode;
}

export interface SkillAssetProjection extends AssetProjection {
  strategy: SkillProjectionStrategy;
}

/**
 * What a runtime actually projects once manifest defaults are applied. An absent asset is
 * either unsupported by the runtime or disabled in the manifest.
 */
export interface ResolvedRuntimeProjection {
  skills?: SkillAssetProjection;
  agents?: AssetProjection;
  workflows?: AssetProjection;
}

export interface ResolvedPolicy {
  name: string;
  source: "manifest" | "override" | "pack" | "default";
  spec: Record<string, unknown>;
}

export interface ResolvedWorkspace {
  workspaceRoot: string;
  manifest: WorkspaceManifest;
  packs: PackResolution[];
  repositories: RepositoryRef[];
  execution: WorkspaceExecution;
  runtimes: Partial<Record<RuntimeName, ResolvedRuntimeProjection>>;
  plugins: WorkspacePlugins;
  selectedAgents: Record<RuntimeName, ResolvedAgent[]>;
  selectedSkills: ResolvedSkill[];
  selectedWorkflows: ResolvedWorkflow[];
  selectedPolicies: ResolvedPolicy[];
  lockfile: WorkspaceLockfile;
}
