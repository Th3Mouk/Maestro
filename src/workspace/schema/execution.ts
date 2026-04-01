import { z } from "zod";

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

export const workspaceExecutionSchema = z.object({
  devcontainer: devcontainerExecutionSchema.default({ enabled: false }),
  worktrees: worktreeExecutionSchema.default({ enabled: true }),
});

export type DevcontainerExecution = z.infer<typeof devcontainerExecutionSchema>;
export type WorktreeExecution = z.infer<typeof worktreeExecutionSchema>;
export type WorkspaceExecution = z.input<typeof workspaceExecutionSchema>;
