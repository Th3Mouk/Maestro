import type { execa } from "execa";
import { getRepositorySparseIncludePaths } from "../../src/workspace/repositories.js";
import type { RuntimeName } from "../../src/runtime/types.js";
import type { RepositoryRef, ResolvedWorkspace } from "../../src/workspace/types.js";

export function createResolvedWorkspaceFixture(input: {
  execution?: ResolvedWorkspace["execution"];
  repositories?: RepositoryRef[];
  runtimes?: ResolvedWorkspace["runtimes"];
  workspaceName?: string;
}): ResolvedWorkspace {
  const repositories = input.repositories ?? [];
  const runtimes = input.runtimes ?? {};
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
      codex: [],
      "claude-code": [],
      opencode: [],
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

export function createRuntimeFixture(
  input: Partial<Record<RuntimeName, ResolvedWorkspace["runtimes"][RuntimeName]>>,
): ResolvedWorkspace["runtimes"] {
  return input;
}
