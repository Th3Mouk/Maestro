import { z } from "zod";

export const runtimeProjectionModeSchema = z.enum(["merge", "replace"]);

export const defaultRuntimeProjectionMode: z.infer<typeof runtimeProjectionModeSchema> = "merge";

export const runtimeConfigSchema = z.object({
  enabled: z.boolean().default(true),
  projectionMode: runtimeProjectionModeSchema.default(defaultRuntimeProjectionMode),
  installProjectConfig: z.boolean().optional(),
  installAgents: z.boolean().optional(),
  useAgentsFile: z.string().optional(),
  installProjectInstructions: z.boolean().optional(),
  instructionsFile: z.string().optional(),
  projectConfigPath: z.string().optional(),
});

export type RuntimeProjectionMode = z.infer<typeof runtimeProjectionModeSchema>;
export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
