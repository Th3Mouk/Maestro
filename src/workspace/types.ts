import type {
  ConflictStrategy as ConflictStrategyFromSchema,
  DevcontainerExecution as DevcontainerExecutionFromSchema,
  McpServer as McpServerFromSchema,
  PackManifest as PackManifestFromSchema,
  PackRef as PackRefFromSchema,
  PolicyRef as PolicyRefFromSchema,
  RepositoryBootstrap as RepositoryBootstrapFromSchema,
  RepositoryPermissions as RepositoryPermissionsFromSchema,
  RepositoryRef as RepositoryRefFromSchema,
  RepositorySparse as RepositorySparseFromSchema,
  RuntimeAgentSelection as RuntimeAgentSelectionFromSchema,
  RuntimeConfig as RuntimeConfigFromSchema,
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
export type PackRef = PackRefFromSchema;
export type PolicyRef = PolicyRefFromSchema;
export type RepositoryPermissions = RepositoryPermissionsFromSchema;
export type RepositoryBootstrap = RepositoryBootstrapFromSchema;
export type RepositorySparse = RepositorySparseFromSchema;
export type RepositoryRef = RepositoryRefFromSchema;
export type McpServer = McpServerFromSchema;
export type WorkspacePlugins = WorkspacePluginsFromSchema;
export type RuntimeAgentSelection = RuntimeAgentSelectionFromSchema;
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
  extension: "toml" | "md" | "json";
}

export interface ResolvedSkill {
  name: string;
  source: "override" | "workspace" | "pack";
  root: string;
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
  runtimes: Partial<Record<RuntimeName, RuntimeConfig>>;
  plugins: WorkspacePlugins;
  selectedAgents: Record<RuntimeName, ResolvedAgent[]>;
  selectedSkills: ResolvedSkill[];
  mcpServers: McpServer[];
  selectedPolicies: ResolvedPolicy[];
  lockfile: WorkspaceLockfile;
}
