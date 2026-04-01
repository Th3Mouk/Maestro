import { z } from "zod";
import { devcontainerExecutionSchema, worktreeExecutionSchema } from "./execution.js";
import { mcpServerSchema } from "./mcp.js";
import { workspacePluginsSchema } from "./plugins.js";
import { conflictSchema, packRefSchema, policyRefSchema, repositorySchema } from "./repository.js";
import { runtimeConfigSchema } from "./runtime.js";

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

export type RuntimeAgentSelection = NonNullable<
  z.infer<typeof workspaceManifestSchema>["spec"]["agents"]
>;
export type WorkspaceManifest = z.infer<typeof workspaceManifestSchema>;
export type PackManifest = z.infer<typeof packManifestSchema>;
