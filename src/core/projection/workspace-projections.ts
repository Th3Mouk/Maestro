import path from "node:path";
import type { RepositoryRef } from "../../workspace/types.js";

const REPOSITORIES_ROOT = "repos";

export function projectRepositoryPath(repositoryName: string): string {
  return asProjectionPosixPath(path.join(REPOSITORIES_ROOT, repositoryName));
}

export function projectRepositoryFolderEntry(repository: Pick<RepositoryRef, "name">): {
  name: string;
  path: string;
} {
  return {
    name: repository.name,
    path: projectRepositoryPath(repository.name),
  };
}

export function renderProjectionJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function asProjectionPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}
