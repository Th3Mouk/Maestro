import deepmerge from "deepmerge";
import path from "node:path";
import YAML from "yaml";
import { z } from "zod";
import type { WorkspaceManifest } from "./types.js";
import { workspaceManifestSchema } from "./schema.js";
import { mapWithConcurrency, pathExists, readText, resolveSafePath } from "../utils/fs.js";
import { workspaceManifestFileName } from "../core/workspace-manifest.js";

const RESOLUTION_CONCURRENCY_LIMIT = 4;
const unknownRecordSchema = z.record(z.string(), z.unknown());
const fragmentSchema = z.union([unknownRecordSchema, z.array(z.unknown())]);
const workspaceIncludesSchema = z.object({
  spec: z
    .object({
      includes: z.array(z.string()).optional(),
    })
    .optional(),
});
const fragmentWithSpecSchema = z.object({
  spec: unknownRecordSchema,
});

export async function loadWorkspaceManifest(workspaceRoot: string): Promise<WorkspaceManifest> {
  const workspaceFile = path.join(workspaceRoot, workspaceManifestFileName);
  const baseContent = unknownRecordSchema.parse(YAML.parse(await readText(workspaceFile)));
  const merged = structuredClone(baseContent);
  const defaultFragmentNames = [
    "repositories",
    "policies",
    "runtimes",
    "packs",
    "execution",
    "plugins",
    "mcpServers",
  ];
  const existingDefaultIncludes = (
    await mapWithConcurrency(
      defaultFragmentNames,
      RESOLUTION_CONCURRENCY_LIMIT,
      async (fragmentName) => {
        const fragmentPath = path.join("fragments", `${fragmentName}.yaml`);
        return (await pathExists(path.join(workspaceRoot, fragmentPath)))
          ? fragmentPath
          : undefined;
      },
    )
  ).filter((fragmentPath): fragmentPath is string => Boolean(fragmentPath));
  const includePaths = [...readWorkspaceIncludes(baseContent), ...existingDefaultIncludes];

  for (const includePath of Array.from(new Set(includePaths))) {
    const absolutePath = resolveSafePath(workspaceRoot, includePath, "workspace include");
    if (!(await pathExists(absolutePath))) {
      continue;
    }

    const parsedFragment = YAML.parse(await readText(absolutePath));
    merged.spec = mergeSpec(merged.spec, parsedFragment);
  }

  return workspaceManifestSchema.parse(merged);
}

export function normalizeFragment(fragment: unknown): Record<string, unknown> {
  const parsedFragment = fragmentSchema.parse(fragment);
  if (Array.isArray(parsedFragment)) {
    return {};
  }

  const parsedWithSpec = fragmentWithSpecSchema.safeParse(parsedFragment);
  if (parsedWithSpec.success) {
    return parsedWithSpec.data.spec;
  }

  return parsedFragment;
}

export function mergeSpec(base: unknown, incoming: unknown): Record<string, unknown> {
  return deepmerge<Record<string, unknown>>(
    asOptionalRecord(base) ?? {},
    normalizeFragment(incoming),
    {
      arrayMerge: (target, source) => [...target, ...source],
    },
  );
}

function readWorkspaceIncludes(value: Record<string, unknown>): string[] {
  const parsed = workspaceIncludesSchema.safeParse(value);
  return parsed.success ? (parsed.data.spec?.includes ?? []) : [];
}

function asOptionalRecord(value: unknown): Record<string, unknown> | undefined {
  const parsed = unknownRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
