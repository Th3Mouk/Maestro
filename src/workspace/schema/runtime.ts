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

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
