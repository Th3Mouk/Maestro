import { z } from "zod";

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

export type WorkspaceLockfile = z.infer<typeof workspaceLockfileSchema>;
export type WorkspaceState = z.infer<typeof workspaceStateSchema>;
export type WorkspaceDescriptor = z.infer<typeof workspaceDescriptorSchema>;
