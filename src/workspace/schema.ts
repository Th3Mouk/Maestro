import { z } from "zod";

export const runtimeConfigSchema = z.object({
  enabled: z.boolean().default(true),
  installProjectConfig: z.boolean().optional(),
  installAgents: z.boolean().optional(),
  useAgentsFile: z.string().optional(),
  installProjectInstructions: z.boolean().optional(),
  instructionsFile: z.string().optional(),
  projectConfigPath: z.string().optional(),
});

export const packRefSchema = z.object({
  name: z.string().min(1),
  version: z.string().optional(),
  visibility: z.enum(["public", "private"]).optional(),
  source: z.string().optional(),
});

export const policyRefSchema = z.object({
  name: z.string().min(1),
  spec: z.record(z.string(), z.unknown()).optional(),
  source: z.string().optional(),
});

export const repositoryBootstrapSchema = z.object({
  enabled: z.boolean().optional(),
  strategy: z.enum(["auto", "manual"]).optional(),
  commands: z.array(z.string().min(1)).optional(),
  workingDirectory: z.string().min(1).optional(),
});

const repositorySparseSchema = z
  .object({
    mode: z.enum(["cone", "pattern"]).optional(),
    includePaths: z.array(z.string().min(1)).optional(),
    excludePaths: z.array(z.string().min(1)).optional(),
    visiblePaths: z.array(z.string().min(1)).optional(),
  })
  .refine(
    (value) =>
      (value.includePaths?.length ?? 0) > 0 ||
      (value.visiblePaths?.length ?? 0) > 0 ||
      (value.excludePaths?.length ?? 0) > 0,
    {
      message:
        "repository sparse config requires includePaths, excludePaths, or the legacy visiblePaths alias",
    },
  );

export const repositorySchema = z.object({
  name: z.string().min(1),
  remote: z.string().min(1),
  branch: z.string().default("main"),
  sparse: repositorySparseSchema.optional(),
  permissions: z
    .object({
      writablePaths: z.array(z.string()).optional(),
      forbiddenPaths: z.array(z.string()).optional(),
    })
    .optional(),
  bootstrap: repositoryBootstrapSchema.optional(),
  stack: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const conflictSchema = z.object({
  strategy: z.enum(["prefer-local", "prefer-pack-first", "prefer-pack-last"]),
});

export const devcontainerExecutionSchema = z.object({
  enabled: z.boolean().default(false),
  workspaceFolder: z.string().optional(),
  remoteUser: z.string().optional(),
  baseImage: z
    .string()
    .min(1)
    .max(255)
    .regex(/^[A-Za-z0-9./:@_-]+$/, {
      message: "baseImage contains unsupported characters",
    })
    .refine((value) => !/[\r\n]/.test(value), {
      message: "baseImage must not contain newlines",
    })
    .optional(),
});

export const worktreeExecutionSchema = z.object({
  enabled: z.boolean().default(true),
  rootDir: z.string().optional(),
  branchPrefix: z.string().optional(),
});

const mcpServerBaseSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean().optional(),
  required: z.boolean().optional(),
  startupTimeoutSec: z.number().int().positive().optional(),
  toolTimeoutSec: z.number().int().positive().optional(),
  enabledTools: z.array(z.string().min(1)).optional(),
  disabledTools: z.array(z.string().min(1)).optional(),
});

const mcpServerStdioSchema = mcpServerBaseSchema.extend({
  transport: z.literal("stdio"),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  envVars: z.array(z.string().min(1)).optional(),
  cwd: z.string().min(1).optional(),
});

const mcpServerHttpSchema = mcpServerBaseSchema.extend({
  transport: z.literal("http"),
  url: z.string().url(),
  bearerTokenEnvVar: z.string().min(1).optional(),
  httpHeaders: z.record(z.string(), z.string()).optional(),
  envHttpHeaders: z.record(z.string(), z.string().min(1)).optional(),
});

export const mcpServerSchema = z.discriminatedUnion("transport", [
  mcpServerStdioSchema,
  mcpServerHttpSchema,
]);

const pluginRefPattern = /^[^@\s]+@[^@\s]+$/;

const enabledPluginMapSchema = z
  .record(z.string(), z.boolean())
  .refine(
    (value) => Object.keys(value).every((pluginRef) => pluginRefPattern.test(pluginRef)),
    "plugin refs must use the form name@marketplace",
  );

const claudeMarketplaceSourceSchema = z.union([
  z.object({
    source: z.literal("github"),
    repo: z.string().min(1),
    ref: z.string().optional(),
  }),
  z.object({
    source: z.literal("git"),
    url: z.string().min(1),
    ref: z.string().optional(),
  }),
  z.object({
    source: z.literal("directory"),
    path: z.string().min(1),
  }),
  z.object({
    source: z.literal("hostPattern"),
    hostPattern: z.string().min(1),
  }),
  z.object({
    source: z.literal("settings"),
    name: z.string().min(1),
    plugins: z.array(z.record(z.string(), z.unknown())).default([]),
  }),
]);

export const workspacePluginsSchema = z.object({
  codex: z
    .object({
      enabled: enabledPluginMapSchema.optional(),
    })
    .optional(),
  "claude-code": z
    .object({
      enabled: enabledPluginMapSchema.optional(),
      marketplaces: z
        .record(
          z.string(),
          z.object({
            source: claudeMarketplaceSourceSchema,
          }),
        )
        .optional(),
    })
    .optional(),
});

export const workspaceExecutionSchema = z.object({
  devcontainer: devcontainerExecutionSchema.default({ enabled: false }),
  worktrees: worktreeExecutionSchema.default({ enabled: true }),
});

export const workspaceManifestSchema = z.object({
  apiVersion: z.string().default("maestro/v1"),
  kind: z.literal("Workspace"),
  metadata: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
  }),
  spec: z.object({
    framework: z
      .object({
        version: z.string().optional(),
      })
      .optional(),
    includes: z.array(z.string()).optional(),
    runtimes: z
      .object({
        codex: runtimeConfigSchema.optional(),
        "claude-code": runtimeConfigSchema.optional(),
        opencode: runtimeConfigSchema.optional(),
      })
      .default({}),
    packs: z.array(packRefSchema).optional(),
    repositories: z.array(repositorySchema),
    execution: z
      .object({
        devcontainer: devcontainerExecutionSchema.optional(),
        worktrees: worktreeExecutionSchema.optional(),
      })
      .optional(),
    agents: z
      .object({
        codex: z.array(z.string()).optional(),
        "claude-code": z.array(z.string()).optional(),
        opencode: z.array(z.string()).optional(),
      })
      .optional(),
    skills: z.array(z.string()).optional(),
    plugins: workspacePluginsSchema.optional(),
    mcpServers: z.array(mcpServerSchema).optional(),
    policies: z.array(policyRefSchema).optional(),
    conflicts: z
      .object({
        skills: z.record(z.string(), conflictSchema).optional(),
        agents: z.record(z.string(), conflictSchema).optional(),
      })
      .optional(),
  }),
});

export const packManifestSchema = z.object({
  apiVersion: z.string().default("maestro/v1"),
  kind: z.literal("Pack"),
  metadata: z.object({
    name: z.string().min(1),
    version: z.string().min(1),
    visibility: z.enum(["public", "private"]).optional(),
  }),
  spec: z.object({
    compatibility: z
      .object({
        framework: z.string().optional(),
      })
      .optional(),
    fragments: z.array(z.string()).optional(),
    provides: z
      .object({
        agents: z
          .object({
            codex: z.array(z.string()).optional(),
            "claude-code": z.array(z.string()).optional(),
            opencode: z.array(z.string()).optional(),
          })
          .optional(),
        skills: z.array(z.string()).optional(),
        policies: z.array(z.string()).optional(),
        templates: z.array(z.string()).optional(),
        hooks: z
          .object({
            install: z.array(z.string()).optional(),
            validate: z.array(z.string()).optional(),
          })
          .optional(),
      })
      .optional(),
  }),
});

export const workspaceLockfileSchema = z.object({
  frameworkVersion: z.string().min(1),
  generatedAt: z.string().min(1),
  packs: z.array(
    z.object({
      name: z.string().min(1),
      version: z.string().min(1),
      visibility: z.string().optional(),
      resolved: z.string().min(1),
    }),
  ),
  repositories: z.array(
    z.object({
      name: z.string().min(1),
      branch: z.string().min(1),
      sparsePaths: z.array(z.string()),
    }),
  ),
});

export const workspaceStateSchema = z.object({
  installedAt: z.string().min(1),
  workspace: z.string().min(1),
  runtimes: z.array(z.string()),
});

export const workspaceDescriptorSchema = z.object({
  schemaVersion: z.literal("maestro.workspace/v1"),
  workspace: z.object({
    name: z.string().min(1),
    root: z.string().min(1),
    manifest: z.string().min(1),
    agentsFile: z.string().min(1),
  }),
  layout: z.object({
    repositoriesRoot: z.string().min(1),
    worktreesRoot: z.string().nullable(),
  }),
  repositories: z.array(
    z.object({
      name: z.string().min(1),
      path: z.string().min(1),
      remote: z.string().min(1),
      referenceBranch: z.string().min(1),
      sparsePaths: z.array(z.string().min(1)),
    }),
  ),
  projections: z.object({
    runtimes: z.array(z.string().min(1)),
    devcontainer: z.string().nullable(),
  }),
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export type PackRef = z.infer<typeof packRefSchema>;
export type PolicyRef = z.infer<typeof policyRefSchema>;
export type RepositoryBootstrap = z.infer<typeof repositoryBootstrapSchema>;
export type RepositoryPermissions = NonNullable<z.infer<typeof repositorySchema>["permissions"]>;
export type RepositorySparse = z.infer<typeof repositorySchema>["sparse"];
export type RepositoryRef = z.infer<typeof repositorySchema>;
export type McpServer = z.infer<typeof mcpServerSchema>;
export type WorkspacePlugins = z.infer<typeof workspacePluginsSchema>;
export type ConflictStrategy = z.infer<typeof conflictSchema>;
export type DevcontainerExecution = z.infer<typeof devcontainerExecutionSchema>;
export type WorktreeExecution = z.infer<typeof worktreeExecutionSchema>;
export type WorkspaceExecution = {
  devcontainer?: DevcontainerExecution;
  worktrees?: WorktreeExecution;
};
export type RuntimeAgentSelection = NonNullable<
  z.infer<typeof workspaceManifestSchema>["spec"]["agents"]
>;
export type WorkspaceManifest = z.infer<typeof workspaceManifestSchema>;
export type PackManifest = z.infer<typeof packManifestSchema>;
export type WorkspaceLockfile = z.infer<typeof workspaceLockfileSchema>;
export type WorkspaceState = z.infer<typeof workspaceStateSchema>;
export type WorkspaceDescriptor = z.infer<typeof workspaceDescriptorSchema>;
