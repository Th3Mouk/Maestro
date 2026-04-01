import { readdir } from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import type {
  PackResolution,
  ResolvedWorkspace,
  WorkspaceLockfile,
  WorkspaceManifest,
} from "../workspace/types.js";
import { supportedRuntimeNames } from "../runtime/types.js";
import { workspaceExecutionSchema, workspaceManifestSchema } from "../workspace/schema.js";
import { resolveAgents, resolvePolicies, resolveSkills } from "../workspace/agent-discovery.js";
import {
  loadWorkspaceManifest as parseWorkspaceManifest,
  mergeSpec,
} from "../workspace/manifest-parser.js";
import { resolvePacks } from "../workspace/pack-resolver.js";
import {
  getRepositoryReferenceBranch,
  getRepositorySparseIncludePaths,
} from "../workspace/repositories.js";
import { ensureDir, pathExists, readText, resolveSafePath } from "../utils/fs.js";
import { getFrameworkVersion } from "../version.js";

const RESOLUTION_CONCURRENCY_LIMIT = 4;
const frameworkVersion = getFrameworkVersion();

export async function loadWorkspaceManifest(workspaceRoot: string): Promise<WorkspaceManifest> {
  return parseWorkspaceManifest(workspaceRoot);
}

export async function resolveWorkspace(workspaceRoot: string): Promise<ResolvedWorkspace> {
  const manifest = await loadWorkspaceManifest(workspaceRoot);
  const packs = await resolvePacks(
    workspaceRoot,
    manifest.spec.packs ?? [],
    frameworkVersion,
    RESOLUTION_CONCURRENCY_LIMIT,
  );
  const manifestWithFragments = await applyPackFragments(manifest, packs);
  const selectedAgents = await resolveAgents(workspaceRoot, manifestWithFragments, packs);
  const selectedSkills = await resolveSkills(workspaceRoot, manifestWithFragments, packs);
  const selectedPolicies = await resolvePolicies(workspaceRoot, manifestWithFragments, packs);
  const runtimes = normalizeRuntimes(manifestWithFragments);

  const lockfile: WorkspaceLockfile = {
    frameworkVersion,
    generatedAt: new Date().toISOString(),
    packs: packs.map((pack) => ({
      name: pack.manifest.metadata.name,
      version: pack.manifest.metadata.version,
      visibility: pack.manifest.metadata.visibility,
      resolved: pack.root,
    })),
    repositories: manifestWithFragments.spec.repositories.map((repository) => ({
      name: repository.name,
      branch: getRepositoryReferenceBranch(repository),
      sparsePaths: getRepositorySparseIncludePaths(repository),
    })),
  };

  return {
    workspaceRoot,
    manifest: manifestWithFragments,
    packs,
    repositories: manifestWithFragments.spec.repositories,
    execution: workspaceExecutionSchema.parse(manifestWithFragments.spec.execution ?? {}),
    runtimes,
    plugins: manifestWithFragments.spec.plugins ?? {},
    selectedAgents,
    selectedSkills,
    mcpServers: manifestWithFragments.spec.mcpServers ?? [],
    selectedPolicies,
    lockfile,
  };
}

export async function ensureWorkspaceSkeleton(
  workspaceRoot: string,
  manifest: WorkspaceManifest,
): Promise<void> {
  if (manifest.spec.repositories.length === 0) {
    return;
  }

  await ensureDir(path.join(workspaceRoot, "repos"));
}

async function applyPackFragments(
  manifest: WorkspaceManifest,
  packs: PackResolution[],
): Promise<WorkspaceManifest> {
  let nextManifest: Record<string, unknown> = {
    ...structuredClone(manifest),
  };
  for (const pack of packs) {
    for (const fragmentPath of pack.manifest.spec.fragments ?? []) {
      const absolutePath = resolveSafePath(
        path.join(pack.root, "fragments"),
        fragmentPath,
        "pack fragment path",
      );
      if (!(await pathExists(absolutePath))) {
        continue;
      }
      const parsed = YAML.parse(await readText(absolutePath));
      nextManifest = {
        ...nextManifest,
        spec: mergeSpec(nextManifest.spec, parsed),
      };
    }
  }
  return workspaceManifestSchema.parse(nextManifest);
}

function normalizeRuntimes(manifest: WorkspaceManifest) {
  const runtimes: ResolvedWorkspace["runtimes"] = {};
  for (const runtime of supportedRuntimeNames) {
    if (manifest.spec.runtimes[runtime]?.enabled) {
      runtimes[runtime] = manifest.spec.runtimes[runtime];
    }
  }
  return runtimes;
}

export async function discoverSparsePaths(repoRoot: string): Promise<string[]> {
  const entries = await readdir(repoRoot, { withFileTypes: true });
  return entries
    .filter((entry) => !entry.name.startsWith(".git"))
    .map((entry) => (entry.isDirectory() ? `${entry.name}/` : entry.name))
    .sort((left, right) => left.localeCompare(right));
}
