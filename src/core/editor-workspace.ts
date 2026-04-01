import type { RepositoryRef } from "../workspace/types.js";
import {
  projectRepositoryFolderEntry,
  renderProjectionJson,
} from "./projection/workspace-projections.js";

export const editorWorkspaceFileName = "maestro.code-workspace";

interface EditorWorkspaceOptions {
  repositories: RepositoryRef[];
  workspaceName?: string;
}

export function renderEditorWorkspace(options: EditorWorkspaceOptions): string {
  return renderProjectionJson({
    folders: [
      {
        name: options.workspaceName ?? "workspace",
        path: ".",
      },
      ...options.repositories.map((repository) => projectRepositoryFolderEntry(repository)),
    ],
    settings: {
      "files.exclude": {
        repos: true,
        ".maestro/worktrees": true,
      },
    },
  });
}
