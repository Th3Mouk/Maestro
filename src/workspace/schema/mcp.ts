import { z } from "zod";

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

export type McpServer = z.infer<typeof mcpServerSchema>;
