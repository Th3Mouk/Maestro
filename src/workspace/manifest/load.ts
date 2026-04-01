import path from "node:path";
import YAML from "yaml";
import { workspaceManifestFileName } from "../../core/workspace-manifest.js";
import { pathExists, readText, resolveSafePath } from "../../utils/fs.js";
import { workspaceManifestSchema } from "../schema.js";
import type { WorkspaceManifest } from "../types.js";
import { discoverWorkspaceIncludePaths } from "./includes.js";
import { mergeSpec } from "./merge.js";
import { unknownRecordSchema } from "./schemas.js";

export async function loadWorkspaceManifest(workspaceRoot: string): Promise<WorkspaceManifest> {
  const workspaceFile = path.join(workspaceRoot, workspaceManifestFileName);
  const baseContent = await readYamlRecord(workspaceFile);
  const mergedSpec = await mergeIncludedFragments(workspaceRoot, baseContent);
  const mergedManifest =
    mergedSpec === baseContent.spec ? baseContent : { ...baseContent, spec: mergedSpec };

  return workspaceManifestSchema.parse(mergedManifest);
}

async function readYamlRecord(filePath: string): Promise<Record<string, unknown>> {
  const content = await readText(filePath);
  return unknownRecordSchema.parse(YAML.parse(content));
}

async function mergeIncludedFragments(
  workspaceRoot: string,
  baseContent: Record<string, unknown>,
): Promise<unknown> {
  let mergedSpec = baseContent.spec;
  const includePaths = await discoverWorkspaceIncludePaths(workspaceRoot, baseContent);
  for (const includePath of includePaths) {
    const fragment = await readIncludeFragment(workspaceRoot, includePath);
    if (fragment === undefined) {
      continue;
    }

    mergedSpec = mergeSpec(mergedSpec, fragment);
  }

  return mergedSpec;
}

async function readIncludeFragment(
  workspaceRoot: string,
  includePath: string,
): Promise<unknown | undefined> {
  const absolutePath = resolveSafePath(workspaceRoot, includePath, "workspace include");
  if (!(await pathExists(absolutePath))) {
    return undefined;
  }

  return YAML.parse(await readText(absolutePath));
}
