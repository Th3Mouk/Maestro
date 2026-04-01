import { z } from "zod";

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

export type WorkspacePlugins = z.infer<typeof workspacePluginsSchema>;
