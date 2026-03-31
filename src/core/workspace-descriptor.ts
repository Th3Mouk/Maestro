import path from "node:path";
import type { RuntimeName } from "../runtime/types.js";
import {
  getRepositoryReferenceBranch,
  getRepositorySparseIncludePaths,
} from "../workspace/repositories.js";
import type { RepositoryRef, WorkspaceExecution } from "../workspace/types.js";

export const workspaceDescriptorFileName = "maestro.json";

interface WorkspaceDescriptorOptions {
  workspaceName: string;
  repositories: RepositoryRef[];
  runtimeNames?: RuntimeName[];
  execution?: WorkspaceExecution;
}

export function renderWorkspaceDescriptor(options: WorkspaceDescriptorOptions): string {
  return `${JSON.stringify(
    {
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
        path: toPosixPath(path.join("repos", repository.name)),
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
    },
    null,
    2,
  )}\n`;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}
