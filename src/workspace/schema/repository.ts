import { z } from "zod";

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

export type PackRef = z.infer<typeof packRefSchema>;
export type PolicyRef = z.infer<typeof policyRefSchema>;
export type RepositoryBootstrap = z.infer<typeof repositoryBootstrapSchema>;
export type RepositoryPermissions = NonNullable<z.infer<typeof repositorySchema>["permissions"]>;
export type RepositorySparse = z.infer<typeof repositorySchema>["sparse"];
export type RepositoryRef = z.infer<typeof repositorySchema>;
export type ConflictStrategy = z.infer<typeof conflictSchema>;
