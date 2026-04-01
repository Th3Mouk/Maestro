import type { RuntimeName } from "../runtime/types.js";
import {
  getRepositoryReferenceBranch,
  getRepositorySparseIncludePaths,
} from "../workspace/repositories.js";
import type { RepositoryRef, WorkspaceExecution } from "../workspace/types.js";
import { projectRepositoryPath, renderProjectionJson } from "./projection/workspace-projections.js";

export const workspaceDescriptorFileName = "maestro.json";

interface WorkspaceDescriptorOptions {
  workspaceName: string;
  repositories: RepositoryRef[];
  runtimeNames?: RuntimeName[];
  execution?: WorkspaceExecution;
}

export function renderWorkspaceDescriptor(options: WorkspaceDescriptorOptions): string {
  return renderProjectionJson({
    schemaVersion: "maestro.workspace/v1",
    workspace: {
      name: options.workspaceName,
      root: ".",
      manifest: "maestro.yaml",
      agentsFile: "AGENTS.md",
    },
    layout: {
      repositoriesRoot: "repos",
      worktreesRoot: options.execution?.worktrees?.enabled ? ".maestro/worktrees" : null,
    },
    repositories: options.repositories.map((repository) => ({
      name: repository.name,
      path: projectRepositoryPath(repository.name),
      remote: repository.remote,
      referenceBranch: getRepositoryReferenceBranch(repository),
      sparsePaths: getRepositorySparseIncludePaths(repository),
    })),
    projections: {
      runtimes: options.runtimeNames ?? [],
      devcontainer: options.execution?.devcontainer?.enabled
        ? ".devcontainer/devcontainer.json"
        : null,
    },
  });
}
