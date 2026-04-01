import path from "node:path";
import type { RuntimeName } from "../../runtime/types.js";
import { ensureDir, withWorkspaceLock, writeJson, writeText } from "../../utils/fs.js";
import { getWorkspaceStateRoot } from "../../workspace/state-directory.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import { editorWorkspaceFileName, renderEditorWorkspace } from "../editor-workspace.js";
import { buildBootstrapPlan, renderBootstrapScript } from "../execution/bootstrap-plan.js";
import {
  renderDevcontainerConfig,
  renderDevcontainerDockerfile,
} from "../execution/devcontainer.js";
import { renderWorkspaceDescriptor, workspaceDescriptorFileName } from "../workspace-descriptor.js";
import { getTaskWorktreesRoot } from "./worktree-root.js";

export async function projectExecutionSupportWithResolvedWorkspace(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  concurrencyLimit: number,
  dryRun = false,
): Promise<string[]> {
  const actions: string[] = [];
  const executionRoot = getWorkspaceStateRoot(workspaceRoot, "execution");
  const bootstrapPlan = await buildBootstrapPlan(
    workspaceRoot,
    resolvedWorkspace,
    concurrencyLimit,
  );

  if (!dryRun) {
    await withWorkspaceLock(workspaceRoot, async () => {
      await ensureDir(executionRoot);
      await writeText(
        path.join(workspaceRoot, workspaceDescriptorFileName),
        renderWorkspaceDescriptor({
          execution: resolvedWorkspace.execution,
          repositories: resolvedWorkspace.repositories,
          runtimeNames: Object.keys(resolvedWorkspace.runtimes) as RuntimeName[],
          workspaceName: resolvedWorkspace.manifest.metadata.name,
        }),
      );
      await writeJson(
        path.join(executionRoot, "bootstrap-plan.json"),
        bootstrapPlan.map((entry) => ({
          commands: entry.commands,
          name: entry.repository.name,
          skipped: entry.skipped,
          toolchains: entry.toolchains,
        })),
      );
      await writeText(
        path.join(executionRoot, "bootstrap.sh"),
        renderBootstrapScript(bootstrapPlan),
      );
    });
  }

  actions.push("execution:bootstrap");
  actions.push("execution:workspace-descriptor");

  if (resolvedWorkspace.execution.worktrees?.enabled) {
    const worktreeConfig = resolvedWorkspace.execution.worktrees;
    if (!dryRun) {
      const worktreeRoot = getTaskWorktreesRoot(workspaceRoot, resolvedWorkspace);
      await withWorkspaceLock(workspaceRoot, async () => {
        await ensureDir(worktreeRoot);
        await writeJson(path.join(executionRoot, "worktrees.json"), {
          branchPrefix: worktreeConfig?.branchPrefix ?? "task",
          rootDir: path.relative(workspaceRoot, worktreeRoot) || ".",
        });
      });
    }
    actions.push("execution:worktrees");
  }

  if (resolvedWorkspace.execution.devcontainer?.enabled) {
    if (!dryRun) {
      await ensureDir(path.join(workspaceRoot, ".devcontainer"));
      await writeText(
        path.join(workspaceRoot, ".devcontainer", "Dockerfile"),
        renderDevcontainerDockerfile(bootstrapPlan, resolvedWorkspace),
      );
      await writeText(
        path.join(workspaceRoot, ".devcontainer", "bootstrap.sh"),
        renderBootstrapScript(bootstrapPlan),
      );
      await writeJson(
        path.join(workspaceRoot, ".devcontainer", "devcontainer.json"),
        renderDevcontainerConfig(resolvedWorkspace),
      );
    }
    actions.push("execution:devcontainer");
  }

  return actions;
}

export async function projectEditorWorkspaceWithResolvedWorkspace(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  dryRun = false,
): Promise<void> {
  if (dryRun) {
    return;
  }

  await withWorkspaceLock(workspaceRoot, async () => {
    await writeText(
      path.join(workspaceRoot, editorWorkspaceFileName),
      renderEditorWorkspace({
        repositories: resolvedWorkspace.repositories,
        workspaceName: resolvedWorkspace.manifest.metadata.name,
      }),
    );
  });
}
