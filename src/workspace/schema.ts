import {
  type DevcontainerExecution,
  type WorktreeExecution,
  type WorkspaceExecution,
  workspaceExecutionSchema,
} from "./schema/execution.js";
import {
  packManifestSchema,
  type NameSelection,
  type PackManifest,
  type RuntimeAgentSelection,
  type WorkspaceManifest,
  workspaceManifestSchema,
} from "./schema/manifests.js";
import { type McpServer } from "./schema/mcp.js";
import { type WorkspacePlugins } from "./schema/plugins.js";
import {
  type ConflictStrategy,
  type PackRef,
  type PolicyRef,
  type RepositoryBootstrap,
  type RepositoryPermissions,
  type RepositoryRef,
  type RepositorySparse,
} from "./schema/repository.js";
import {
  defaultRuntimeProjectionMode,
  type RuntimeConfig,
  type RuntimeProjectionMode,
} from "./schema/runtime.js";
import {
  type WorkspaceDescriptor,
  type WorkspaceLockfile,
  type WorkspaceState,
  workspaceDescriptorSchema,
  workspaceLockfileSchema,
  workspaceStateSchema,
} from "./schema/state.js";

export {
  workspaceExecutionSchema,
  workspaceManifestSchema,
  packManifestSchema,
  workspaceLockfileSchema,
  workspaceStateSchema,
  workspaceDescriptorSchema,
  defaultRuntimeProjectionMode,
};

export type {
  RuntimeConfig,
  RuntimeProjectionMode,
  PackRef,
  PolicyRef,
  RepositoryBootstrap,
  RepositoryPermissions,
  RepositorySparse,
  RepositoryRef,
  McpServer,
  WorkspacePlugins,
  ConflictStrategy,
  DevcontainerExecution,
  WorktreeExecution,
  WorkspaceExecution,
  RuntimeAgentSelection,
  NameSelection,
  WorkspaceManifest,
  PackManifest,
  WorkspaceLockfile,
  WorkspaceState,
  WorkspaceDescriptor,
};
