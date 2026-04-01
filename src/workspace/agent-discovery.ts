import { readFile } from "node:fs/promises";
import path from "node:path";
import { supportedRuntimeNames, type RuntimeName } from "../runtime/types.js";
import type {
  PackResolution,
  ResolvedAgent,
  ResolvedPolicy,
  ResolvedSkill,
  WorkspaceManifest,
} from "./types.js";
import { mapWithConcurrency, readText, resolveSafePath } from "../utils/fs.js";
import { resolvePackCollision } from "./discovery/collision.js";
import { createDefaultAgent } from "./discovery/default-agent.js";
import { findAgentFile, findPolicyFile, findSkillRoot } from "./discovery/lookup.js";
import { parsePolicyYamlDocument } from "./discovery/policy-yaml.js";

const RESOLUTION_CONCURRENCY_LIMIT = 4;

export async function resolveAgents(
  workspaceRoot: string,
  manifest: WorkspaceManifest,
  packs: PackResolution[],
): Promise<Record<RuntimeName, ResolvedAgent[]>> {
  const result: Record<RuntimeName, ResolvedAgent[]> = {
    codex: [],
    "claude-code": [],
    opencode: [],
  };

  for (const runtime of supportedRuntimeNames) {
    const requested = new Set([
      ...(manifest.spec.agents?.[runtime] ?? []),
      ...packs.flatMap((pack) => pack.manifest.spec.provides?.agents?.[runtime] ?? []),
    ]);

    for (const name of requested) {
      const agent = await resolveAgent(workspaceRoot, runtime, name, manifest, packs);
      result[runtime].push(agent);
    }
  }

  return result;
}

export async function resolveSkills(
  workspaceRoot: string,
  manifest: WorkspaceManifest,
  packs: PackResolution[],
): Promise<ResolvedSkill[]> {
  const requested = new Set([
    ...(manifest.spec.skills ?? []),
    ...packs.flatMap((pack) => pack.manifest.spec.provides?.skills ?? []),
  ]);
  const result: ResolvedSkill[] = [];

  for (const name of requested) {
    const overrideRoot = await findSkillRoot(path.join(workspaceRoot, "overrides", "skills"), name);
    if (overrideRoot) {
      result.push({ name, source: "override", root: overrideRoot });
      continue;
    }

    const workspaceRootSkill = await findSkillRoot(path.join(workspaceRoot, "skills"), name);
    if (workspaceRootSkill) {
      result.push({ name, source: "workspace", root: workspaceRootSkill });
      continue;
    }

    const packRoots = (
      await mapWithConcurrency(packs, RESOLUTION_CONCURRENCY_LIMIT, async (pack) => {
        return findSkillRoot(resolveSafePath(pack.root, "skills", "pack skills root"), name);
      })
    ).filter((entry): entry is string => Boolean(entry));

    const packRoot = resolvePackCollision(
      packRoots,
      manifest.spec.conflicts?.skills?.[name]?.strategy,
      `Skill collision for ${name}`,
    );
    if (packRoot) {
      result.push({ name, source: "pack", root: packRoot });
      continue;
    }

    throw new Error(`Skill not found: ${name}`);
  }

  return result;
}

export async function resolvePolicies(
  workspaceRoot: string,
  manifest: WorkspaceManifest,
  packs: PackResolution[],
): Promise<ResolvedPolicy[]> {
  const result: ResolvedPolicy[] = [];
  for (const policyRef of manifest.spec.policies ?? []) {
    result.push(
      await resolvePolicy(workspaceRoot, policyRef.name, "manifest", policyRef.spec ?? {}, packs),
    );
  }

  for (const pack of packs) {
    for (const name of pack.manifest.spec.provides?.policies ?? []) {
      const alreadyDefined = result.some((entry) => entry.name === name);
      if (alreadyDefined) {
        continue;
      }

      result.push(await resolvePolicy(workspaceRoot, name, "pack", undefined, [pack]));
    }
  }

  return result;
}

async function resolveAgent(
  workspaceRoot: string,
  runtime: RuntimeName,
  name: string,
  manifest: WorkspaceManifest,
  packs: PackResolution[],
): Promise<ResolvedAgent> {
  const overridePath = await findAgentFile(
    path.join(workspaceRoot, "overrides", "agents", runtime),
    name,
  );
  if (overridePath) {
    return createResolvedAgent(name, runtime, overridePath, "override");
  }

  const workspacePath = await findAgentFile(path.join(workspaceRoot, "agents", runtime), name);
  if (workspacePath) {
    return createResolvedAgent(name, runtime, workspacePath, "workspace");
  }

  const packPaths = (
    await Promise.all(
      packs.map((pack) =>
        findAgentFile(
          resolveSafePath(
            resolveSafePath(pack.root, "agents", "pack agents root"),
            runtime,
            "runtime",
          ),
          name,
        ),
      ),
    )
  ).filter((entry): entry is string => Boolean(entry));

  const selectedPath = resolvePackCollision(
    packPaths,
    manifest.spec.conflicts?.agents?.[name]?.strategy,
    `Agent collision for ${name} on runtime ${runtime}`,
  );
  if (selectedPath) {
    return createResolvedAgent(name, runtime, selectedPath, "pack");
  }

  return createDefaultAgent(name, runtime);
}

async function resolvePolicy(
  workspaceRoot: string,
  name: string,
  source: "manifest" | "pack",
  inlineSpec: Record<string, unknown> | undefined,
  packs: PackResolution[],
): Promise<ResolvedPolicy> {
  if (inlineSpec && Object.keys(inlineSpec).length > 0) {
    return { name, source: "manifest", spec: inlineSpec };
  }

  const overridePath = await findPolicyFile(
    path.join(workspaceRoot, "overrides", "policies"),
    name,
  );
  if (overridePath) {
    const parsed = parsePolicyYamlDocument(await readText(overridePath));
    return { name: parsed.name ?? name, source: "override", spec: parsed.spec ?? {} };
  }

  const packMatches = (
    await mapWithConcurrency(packs, RESOLUTION_CONCURRENCY_LIMIT, async (pack) =>
      findPolicyFile(resolveSafePath(pack.root, "policies", "pack policies root"), name),
    )
  ).filter((policyPath): policyPath is string => Boolean(policyPath));

  if (packMatches.length > 1) {
    throw new Error(`Policy collision for ${name}`);
  }

  if (packMatches.length === 1) {
    const parsed = parsePolicyYamlDocument(await readText(packMatches[0]));
    return { name: parsed.name ?? name, source, spec: parsed.spec ?? {} };
  }

  return { name, source: "default", spec: {} };
}

async function createResolvedAgent(
  name: string,
  runtime: RuntimeName,
  filePath: string,
  source: ResolvedAgent["source"],
): Promise<ResolvedAgent> {
  const extension = path.extname(filePath).replace(".", "") as ResolvedAgent["extension"];
  return {
    name,
    runtime,
    source,
    filePath,
    content: await readFile(filePath, "utf8"),
    extension,
  };
}
