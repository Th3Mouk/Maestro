import { readFile } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { supportedRuntimeNames, type RuntimeName } from "../runtime/types.js";
import type {
  PackResolution,
  ResolvedAgent,
  ResolvedPolicy,
  ResolvedSkill,
  WorkspaceManifest,
} from "./types.js";
import { mapWithConcurrency, pathExists, readText, resolveSafePath } from "../utils/fs.js";

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
    const overrideSkillsRoot = path.join(workspaceRoot, "overrides", "skills");
    const overrideRoot = resolveSafePath(overrideSkillsRoot, name, "skill name");
    if (await pathExists(path.join(overrideRoot, "SKILL.md"))) {
      result.push({ name, source: "override", root: overrideRoot });
      continue;
    }

    const workspaceSkillsRoot = path.join(workspaceRoot, "skills");
    const workspaceRootSkill = resolveSafePath(workspaceSkillsRoot, name, "skill name");
    if (await pathExists(path.join(workspaceRootSkill, "SKILL.md"))) {
      result.push({ name, source: "workspace", root: workspaceRootSkill });
      continue;
    }

    const packRoots = (
      await mapWithConcurrency(packs, RESOLUTION_CONCURRENCY_LIMIT, async (pack) => {
        const root = resolveSafePath(
          resolveSafePath(pack.root, "skills", "pack skills root"),
          name,
          "skill name",
        );
        return (await pathExists(path.join(root, "SKILL.md"))) ? root : undefined;
      })
    ).filter((entry): entry is string => Boolean(entry));

    if (packRoots.length > 1) {
      const strategy = manifest.spec.conflicts?.skills?.[name]?.strategy;
      if (!strategy) {
        throw new Error(`Skill collision for ${name}`);
      }
      const root = strategy === "prefer-pack-last" ? packRoots.at(-1)! : packRoots[0];
      result.push({ name, source: "pack", root });
      continue;
    }

    if (packRoots.length === 1) {
      result.push({ name, source: "pack", root: packRoots[0] });
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
  const overridePath = await findFirst(
    path.join(workspaceRoot, "overrides", "agents", runtime),
    name,
  );
  if (overridePath) {
    return createResolvedAgent(name, runtime, overridePath, "override");
  }

  const workspacePath = await findFirst(path.join(workspaceRoot, "agents", runtime), name);
  if (workspacePath) {
    return createResolvedAgent(name, runtime, workspacePath, "workspace");
  }

  const packPaths = (
    await Promise.all(packs.map((pack) => findFirst(path.join(pack.root, "agents", runtime), name)))
  ).filter((entry): entry is string => Boolean(entry));

  if (packPaths.length > 1) {
    const strategy = manifest.spec.conflicts?.agents?.[name]?.strategy;
    if (!strategy) {
      throw new Error(`Agent collision for ${name} on runtime ${runtime}`);
    }

    const selectedPath = strategy === "prefer-pack-last" ? packPaths.at(-1)! : packPaths[0];
    return createResolvedAgent(name, runtime, selectedPath, "pack");
  }

  if (packPaths.length === 1) {
    return createResolvedAgent(name, runtime, packPaths[0], "pack");
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

  const overridePath = resolveSafePath(
    path.join(workspaceRoot, "overrides", "policies"),
    `${name}.yaml`,
    "policy file",
  );
  if (await pathExists(overridePath)) {
    const parsed = parsePolicyYamlDocument(await readText(overridePath));
    return { name: parsed.name ?? name, source: "override", spec: parsed.spec ?? {} };
  }

  const packMatches = (
    await mapWithConcurrency(packs, RESOLUTION_CONCURRENCY_LIMIT, async (pack) => {
      const policyPath = resolveSafePath(
        resolveSafePath(pack.root, "policies", "pack policies root"),
        `${name}.yaml`,
        "policy file",
      );
      return (await pathExists(policyPath)) ? policyPath : undefined;
    })
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

async function findFirst(root: string, name: string): Promise<string | undefined> {
  resolveSafePath(root, name, "agent name");
  for (const extension of ["toml", "md", "json"] as const) {
    const candidatePath = resolveSafePath(root, `${name}.${extension}`, "agent file");
    if (await pathExists(candidatePath)) {
      return candidatePath;
    }
  }

  return undefined;
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

function createDefaultAgent(name: string, runtime: RuntimeName): ResolvedAgent {
  const contentByRuntime: Record<RuntimeName, string> = {
    codex: [
      "# Generated agent",
      `name = "${name}"`,
      `prompt = "Act as ${name} for workspace maintenance."`,
    ].join("\n"),
    "claude-code": `# ${name}\n\nGenerated agent for Claude Code.\n`,
    opencode: `# ${name}\n\nGenerated agent for OpenCode.\n`,
  };

  return {
    name,
    runtime,
    source: "default",
    content: contentByRuntime[runtime],
    extension: runtime === "codex" ? "toml" : "md",
  };
}

function parsePolicyYamlDocument(content: string): {
  name: string | undefined;
  spec: Record<string, unknown> | undefined;
} {
  const parsed = YAML.parse(content);
  if (!isRecord(parsed)) {
    return { name: undefined, spec: undefined };
  }

  const rawName = parsed["name"];
  const rawSpec = parsed["spec"];
  return {
    name: typeof rawName === "string" ? rawName : undefined,
    spec: isRecord(rawSpec) ? rawSpec : undefined,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
