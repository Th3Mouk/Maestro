import { z } from "zod";

export const runtimeProjectionModeSchema = z.enum(["merge", "replace"]);

export const defaultRuntimeProjectionMode: z.infer<typeof runtimeProjectionModeSchema> = "merge";

// `copy` materializes a real directory; `symlink` points `.claude/skills/<name>` at the
// `.agents/skills/<name>` copy so both runtimes read one tree.
const skillProjectionStrategySchema = z.enum(["symlink", "copy"]);

const assetProjectionObjectSchema = z.object({
  mode: runtimeProjectionModeSchema.optional(),
});

// `true` or `{}` enables an asset with its defaults, `false` disables it.
const assetProjectionSchema = z.union([z.boolean(), assetProjectionObjectSchema]);

const skillProjectionSchema = z.union([
  z.boolean(),
  assetProjectionObjectSchema.extend({
    strategy: skillProjectionStrategySchema.optional(),
  }),
]);

const runtimeBaseSchema = z.object({
  enabled: z.boolean().default(true),
  // Runtime-wide default for every asset `mode` below.
  projectionMode: runtimeProjectionModeSchema.optional(),
  installProjectConfig: z.boolean().optional(),
  installAgents: z.boolean().optional(),
  useAgentsFile: z.string().optional(),
  projectConfigPath: z.string().optional(),
  // Agent projection is off until a runtime defines `agents`.
  agents: assetProjectionSchema.optional(),
});

export const standardRuntimeConfigSchema = runtimeBaseSchema.extend({
  skills: skillProjectionSchema.optional(),
});

export const claudeCodeRuntimeConfigSchema = runtimeBaseSchema.extend({
  skills: skillProjectionSchema.optional(),
  workflows: assetProjectionSchema.optional(),
});

export const agentOnlyRuntimeConfigSchema = runtimeBaseSchema;

export type RuntimeProjectionMode = z.infer<typeof runtimeProjectionModeSchema>;
export type SkillProjectionStrategy = z.infer<typeof skillProjectionStrategySchema>;
export type RuntimeConfig = z.infer<typeof claudeCodeRuntimeConfigSchema>;
