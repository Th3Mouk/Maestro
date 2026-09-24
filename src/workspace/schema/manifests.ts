import { z } from "zod";
import { devcontainerExecutionSchema, worktreeExecutionSchema } from "./execution.js";
import { workspacePluginsSchema } from "./plugins.js";
import { conflictSchema, packRefSchema, policyRefSchema, repositorySchema } from "./repository.js";
import {
  agentOnlyRuntimeConfigSchema,
  claudeCodeRuntimeConfigSchema,
  standardRuntimeConfigSchema,
} from "./runtime.js";

// A bare array selects exactly those names (existing behavior). `{ exclude }` selects
// every discovered/pack-provided name except the listed ones. Omitting the field
// entirely (see agent-discovery.ts) selects all of them.
const nameSelectionSchema = z.union([
  z.array(z.string()),
  z.object({ exclude: z.array(z.string()) }),
]);

const runtimeAgentSelectionSchema = z.object({
  standard: nameSelectionSchema.optional(),
  "claude-code": nameSelectionSchema.optional(),
  codex: nameSelectionSchema.optional(),
  cursor: nameSelectionSchema.optional(),
  copilot: nameSelectionSchema.optional(),
  gemini: nameSelectionSchema.optional(),
  opencode: nameSelectionSchema.optional(),
  kilo: nameSelectionSchema.optional(),
  devin: nameSelectionSchema.optional(),
});

const packAgentProvisionSchema = z.object({
  standard: z.array(z.string()).optional(),
  "claude-code": z.array(z.string()).optional(),
  codex: z.array(z.string()).optional(),
  cursor: z.array(z.string()).optional(),
  copilot: z.array(z.string()).optional(),
  gemini: z.array(z.string()).optional(),
  opencode: z.array(z.string()).optional(),
  kilo: z.array(z.string()).optional(),
  devin: z.array(z.string()).optional(),
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
    // Omitting `runtimes` entirely applies the canonical layout (see workspace-service.ts);
    // an explicit `{}` projects nothing.
    runtimes: z
      .object({
        standard: standardRuntimeConfigSchema.optional(),
        "claude-code": claudeCodeRuntimeConfigSchema.optional(),
        codex: agentOnlyRuntimeConfigSchema.optional(),
        cursor: agentOnlyRuntimeConfigSchema.optional(),
        copilot: agentOnlyRuntimeConfigSchema.optional(),
        gemini: agentOnlyRuntimeConfigSchema.optional(),
        opencode: agentOnlyRuntimeConfigSchema.optional(),
        kilo: agentOnlyRuntimeConfigSchema.optional(),
        devin: agentOnlyRuntimeConfigSchema.optional(),
      })
      .optional(),
    packs: z.array(packRefSchema).optional(),
    repositories: z.array(repositorySchema),
    execution: z
      .object({
        devcontainer: devcontainerExecutionSchema.optional(),
        worktrees: worktreeExecutionSchema.optional(),
      })
      .optional(),
    agents: runtimeAgentSelectionSchema.optional(),
    skills: nameSelectionSchema.optional(),
    workflows: nameSelectionSchema.optional(),
    plugins: workspacePluginsSchema.optional(),
    policies: z.array(policyRefSchema).optional(),
    conflicts: z
      .object({
        skills: z.record(z.string(), conflictSchema).optional(),
        agents: z.record(z.string(), conflictSchema).optional(),
        workflows: z.record(z.string(), conflictSchema).optional(),
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
        agents: packAgentProvisionSchema.optional(),
        skills: z.array(z.string()).optional(),
        workflows: z.array(z.string()).optional(),
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

export type NameSelection = z.infer<typeof nameSelectionSchema>;
export type RuntimeAgentSelection = NonNullable<
  z.infer<typeof workspaceManifestSchema>["spec"]["agents"]
>;
export type WorkspaceManifest = z.infer<typeof workspaceManifestSchema>;
export type PackManifest = z.infer<typeof packManifestSchema>;
