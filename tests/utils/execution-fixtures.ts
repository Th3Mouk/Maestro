import type { execa } from "execa";
import { getRepositorySparseIncludePaths } from "../../src/workspace/repositories.js";
import type { RuntimeName } from "../../src/runtime/types.js";
import type { RepositoryRef, ResolvedWorkspace, RuntimeConfig } from "../../src/workspace/types.js";

type PartialRuntimes = Partial<Record<RuntimeName, Partial<RuntimeConfig>>>;

function withRuntimeConfigDefaults(runtimes: PartialRuntimes): ResolvedWorkspace["runtimes"] {
  const resolved: ResolvedWorkspace["runtimes"] = {};
  for (const runtimeName of Object.keys(runtimes) as RuntimeName[]) {
    const config = runtimes[runtimeName];
    if (!config) {
      continue;
    }
    resolved[runtimeName] = { enabled: true, projectionMode: "merge", ...config };
  }
  return resolved;
}

export function createResolvedWorkspaceFixture(input: {
  execution?: ResolvedWorkspace["execution"];
  repositories?: RepositoryRef[];
  runtimes?: PartialRuntimes;
  workspaceName?: string;
}): ResolvedWorkspace {
  const repositories = input.repositories ?? [];
  const runtimes = withRuntimeConfigDefaults(input.runtimes ?? {});
  const workspaceName = input.workspaceName ?? "demo-workspace";

  return {
    execution: input.execution ?? {
      devcontainer: { enabled: false },
      worktrees: { enabled: true },
    },
    lockfile: {
      frameworkVersion: "0.0.0-test",
      generatedAt: "1970-01-01T00:00:00.000Z",
      packs: [],
      repositories: repositories.map((repository) => ({
        branch: repository.branch,
        name: repository.name,
        sparsePaths: getRepositorySparseIncludePaths(repository),
      })),
    },
    manifest: {
      apiVersion: "maestro/v1",
      kind: "Workspace",
      metadata: { name: workspaceName },
      spec: {
        repositories,
        runtimes,
      },
    },
    packs: [],
    repositories,
    runtimes,
    plugins: {},
    selectedAgents: {
      "claude-code": [],
      standard: [],
    },
    selectedPolicies: [],
    selectedSkills: [],
    mcpServers: [],
    workspaceRoot: "/tmp/demo-workspace",
  };
}

export function createExecaResultFixture(): Awaited<ReturnType<typeof execa>> {
  return { stdout: "", stderr: "" } as unknown as Awaited<ReturnType<typeof execa>>;
}

export function createRepositoryFixture(
  input: Partial<RepositoryRef> & Pick<RepositoryRef, "name">,
): RepositoryRef {
  return {
    branch: "main",
    remote: `git@github.com:org/${input.name}.git`,
    sparse: { visiblePaths: ["."] },
    ...input,
  };
}

export function createRuntimeFixture(input: PartialRuntimes): ResolvedWorkspace["runtimes"] {
  return withRuntimeConfigDefaults(input);
}
