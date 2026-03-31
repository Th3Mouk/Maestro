import path from "node:path";
import type { RepositoryRef } from "../workspace/types.js";

export const editorWorkspaceFileName = "maestro.code-workspace";

interface EditorWorkspaceOptions {
  repositories: RepositoryRef[];
  workspaceName?: string;
}

export function renderEditorWorkspace(options: EditorWorkspaceOptions): string {
  return `${JSON.stringify(
    {
      folders: [
        {
          name: options.workspaceName ?? "workspace",
          path: ".",
        },
        ...options.repositories.map((repository) => ({
          name: repository.name,
          path: toPosixPath(path.join("repos", repository.name)),
        })),
      ],
      settings: {
        "files.exclude": {
          repos: true,
          ".maestro/worktrees": true,
        },
      },
    },
    null,
    2,
  )}\n`;
}

function toPosixPath(value: string): string {
  return value.split(path.sep).join("/");
}
