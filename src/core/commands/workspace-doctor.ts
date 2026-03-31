import path from "node:path";
import type { DoctorReport } from "../../report/types.js";
import type { RuntimeName } from "../../runtime/types.js";
import {
  pathExists,
  readText,
  resolveSafePath,
  withWorkspaceLock,
  writeJson,
} from "../../utils/fs.js";
import {
  workspaceDescriptorSchema,
  workspaceLockfileSchema,
  workspaceStateSchema,
} from "../../workspace/schema.js";
import {
  getRepositoryReferenceBranch,
  getRepositorySparseExcludePaths,
  getRepositorySparseIncludePaths,
} from "../../workspace/repositories.js";
import { workspaceStateDirName } from "../../workspace/state-directory.js";
import type { CommandContext } from "../command-context.js";
import { errorMessage, escalateStatus, MaestroError } from "../errors.js";
import { workspaceDescriptorFileName } from "../workspace-descriptor.js";
import { discoverSparsePaths, resolveWorkspace } from "../workspace-service.js";
import { runPackHooks } from "./pack-hooks.js";

export async function doctorWorkspace(
  workspaceRoot: string,
  context: CommandContext,
): Promise<DoctorReport> {
  const report: DoctorReport = {
    status: "ok",
    workspace: path.basename(workspaceRoot),
    issues: [],
  };

  try {
    const resolvedWorkspace = await resolveWorkspace(workspaceRoot);
    report.workspace = resolvedWorkspace.manifest.metadata.name;

    const lockfilePath = resolveSafePath(
      workspaceRoot,
      path.join(workspaceStateDirName, "lock.json"),
      "workspace lockfile",
    );
    if (!(await pathExists(lockfilePath))) {
      report.status = escalateStatus(report.status, "warning");
      report.issues.push({ code: "LOCKFILE_MISSING", message: "Lockfile is missing." });
    } else {
      try {
        workspaceLockfileSchema.parse(JSON.parse(await readText(lockfilePath)));
      } catch (error) {
        report.status = escalateStatus(report.status, "warning");
        report.issues.push({
          code: "LOCKFILE_INVALID",
          message: errorMessage(
            new MaestroError({
              code: "LOCKFILE_INVALID",
              message: "Lockfile content is invalid.",
              path: lockfilePath,
              cause: error,
            }),
          ),
          path: lockfilePath,
        });
      }
    }

    const statePath = resolveSafePath(
      workspaceRoot,
      path.join(workspaceStateDirName, "state.json"),
      "workspace state",
    );
    if (await pathExists(statePath)) {
      try {
        workspaceStateSchema.parse(JSON.parse(await readText(statePath)));
      } catch (error) {
        report.status = escalateStatus(report.status, "warning");
        report.issues.push({
          code: "STATE_INVALID",
          message: errorMessage(
            new MaestroError({
              code: "STATE_INVALID",
              message: "Workspace state content is invalid.",
              path: statePath,
              cause: error,
            }),
          ),
          path: statePath,
        });
      }
    }

    for (const repository of resolvedWorkspace.repositories) {
      const repoRoot = resolveSafePath(
        workspaceRoot,
        path.join("repos", repository.name),
        "repository root",
      );
      if (!(await context.gitAdapter.hasGitMetadata(repoRoot))) {
        report.status = escalateStatus(report.status, "warning");
        report.issues.push({
          code: "REPO_MISSING",
          message: `Repository not installed: ${repository.name}`,
          path: repoRoot,
        });
        continue;
      }

      const remote = await context.gitAdapter.getRemoteUrl(repoRoot);
      if (remote !== repository.remote) {
        report.status = escalateStatus(report.status, "warning");
        report.issues.push({
          code: "REMOTE_MISMATCH",
          message: `Remote differs for ${repository.name}`,
          path: repoRoot,
        });
      }

      const branch = await context.gitAdapter.getCurrentBranch(repoRoot);
      const referenceBranch = getRepositoryReferenceBranch(repository);
      if (branch !== referenceBranch) {
        report.status = escalateStatus(report.status, "warning");
        report.issues.push({
          code: "BRANCH_MISMATCH",
          message: `Active branch is ${branch} instead of reference branch ${referenceBranch}`,
          path: repoRoot,
        });
      }

      const visibleEntries = await discoverSparsePaths(repoRoot);
      const includePaths = getRepositorySparseIncludePaths(repository);
      const excludePaths = getRepositorySparseExcludePaths(repository);

      for (const visiblePath of includePaths) {
        const normalized = visiblePath.endsWith("/")
          ? visiblePath
          : visiblePath.replace(/\/+$/, "");
        const present = visibleEntries.some(
          (entry) => entry === visiblePath || entry === normalized || entry.startsWith(normalized),
        );

        if (!present) {
          report.status = escalateStatus(report.status, "warning");
          report.issues.push({
            code: "SPARSE_PATH_MISSING",
            message: `Sparse path is missing: ${visiblePath}`,
            path: repoRoot,
          });
        }
      }

      for (const excludedPath of excludePaths) {
        const normalized = excludedPath.endsWith("/")
          ? excludedPath
          : excludedPath.replace(/\/+$/, "");
        const present = visibleEntries.some(
          (entry) => entry === excludedPath || entry === normalized || entry.startsWith(normalized),
        );

        if (present) {
          report.status = escalateStatus(report.status, "warning");
          report.issues.push({
            code: "SPARSE_PATH_PRESENT",
            message: `Sparse exclusion is still present: ${excludedPath}`,
            path: repoRoot,
          });
        }
      }
    }

    for (const runtime of Object.keys(resolvedWorkspace.runtimes) as RuntimeName[]) {
      const requiredPaths =
        runtime === "codex"
          ? [resolveSafePath(workspaceRoot, path.join(".codex", "config.toml"), "codex config")]
          : runtime === "claude-code"
            ? [
                resolveSafePath(workspaceRoot, "CLAUDE.md", "claude instructions"),
                resolveSafePath(
                  workspaceRoot,
                  path.join(".claude", "settings.json"),
                  "claude settings",
                ),
                ...(resolvedWorkspace.mcpServers.length > 0
                  ? [resolveSafePath(workspaceRoot, ".mcp.json", "claude mcp config")]
                  : []),
              ]
            : [
                resolveSafePath(
                  workspaceRoot,
                  path.join(".opencode", "opencode.json"),
                  "opencode config",
                ),
              ];

      for (const requiredPath of requiredPaths) {
        if (!(await pathExists(requiredPath))) {
          report.status = escalateStatus(report.status, "warning");
          report.issues.push({
            code: "RUNTIME_ARTIFACT_MISSING",
            message: `Runtime artifact is missing for ${runtime}.`,
            path: requiredPath,
          });
        }
      }
    }

    const marketplacePath = resolveSafePath(
      workspaceRoot,
      path.join(".agents", "plugins", "marketplace.json"),
      "plugin marketplace",
    );
    if (await pathExists(marketplacePath)) {
      try {
        const marketplace = JSON.parse(await readText(marketplacePath)) as {
          plugins?: Array<{
            name?: string;
            source?: { source?: string; path?: string };
          }>;
        };
        for (const plugin of marketplace.plugins ?? []) {
          if (plugin.source?.source !== "local" || !plugin.source.path) {
            continue;
          }
          const pluginRoot = resolveSafePath(
            workspaceRoot,
            plugin.source.path,
            `plugin source for ${plugin.name ?? "unknown plugin"}`,
          );
          const hasCodexManifest = await pathExists(
            path.join(pluginRoot, ".codex-plugin", "plugin.json"),
          );
          const hasClaudeManifest = await pathExists(
            path.join(pluginRoot, ".claude-plugin", "plugin.json"),
          );
          if (!hasCodexManifest && !hasClaudeManifest) {
            report.status = escalateStatus(report.status, "warning");
            report.issues.push({
              code: "PLUGIN_MANIFEST_MISSING",
              message: `Plugin is missing a native manifest: ${plugin.name ?? plugin.source.path}`,
              path: pluginRoot,
            });
          }
        }
      } catch (error) {
        report.status = escalateStatus(report.status, "warning");
        report.issues.push({
          code: "PLUGIN_MARKETPLACE_INVALID",
          message: errorMessage(
            new MaestroError({
              code: "PLUGIN_MARKETPLACE_INVALID",
              message: "Plugin marketplace content is invalid.",
              path: marketplacePath,
              cause: error,
            }),
          ),
          path: marketplacePath,
        });
      }
    }

    const bootstrapPlanPath = resolveSafePath(
      workspaceRoot,
      path.join(workspaceStateDirName, "execution", "bootstrap-plan.json"),
      "bootstrap plan path",
    );
    if (!(await pathExists(bootstrapPlanPath))) {
      report.status = escalateStatus(report.status, "warning");
      report.issues.push({
        code: "EXECUTION_BOOTSTRAP_MISSING",
        message: "Bootstrap plan is missing.",
        path: bootstrapPlanPath,
      });
    }

    const workspaceDescriptorPath = resolveSafePath(
      workspaceRoot,
      workspaceDescriptorFileName,
      "workspace descriptor file",
    );
    if (!(await pathExists(workspaceDescriptorPath))) {
      report.status = escalateStatus(report.status, "warning");
      report.issues.push({
        code: "WORKSPACE_DESCRIPTOR_MISSING",
        message: "Workspace descriptor file is missing.",
        path: workspaceDescriptorPath,
      });
    } else {
      try {
        workspaceDescriptorSchema.parse(JSON.parse(await readText(workspaceDescriptorPath)));
      } catch (error) {
        report.status = escalateStatus(report.status, "warning");
        report.issues.push({
          code: "WORKSPACE_DESCRIPTOR_INVALID",
          message: errorMessage(
            new MaestroError({
              code: "WORKSPACE_DESCRIPTOR_INVALID",
              message: "Workspace descriptor content is invalid.",
              path: workspaceDescriptorPath,
              cause: error,
            }),
          ),
          path: workspaceDescriptorPath,
        });
      }
    }

    if (resolvedWorkspace.execution.worktrees?.enabled) {
      const worktreeConfigPath = path.join(workspaceStateDirName, "execution", "worktrees.json");
      const worktreeConfigAbsolutePath = resolveSafePath(
        workspaceRoot,
        worktreeConfigPath,
        "worktree config path",
      );
      if (!(await pathExists(worktreeConfigAbsolutePath))) {
        report.status = escalateStatus(report.status, "warning");
        report.issues.push({
          code: "WORKTREE_CONFIG_MISSING",
          message: "Worktree configuration is missing.",
          path: worktreeConfigAbsolutePath,
        });
      }
    }

    if (resolvedWorkspace.execution.devcontainer?.enabled) {
      for (const requiredPath of [
        resolveSafePath(
          workspaceRoot,
          path.join(".devcontainer", "devcontainer.json"),
          "devcontainer config",
        ),
        resolveSafePath(
          workspaceRoot,
          path.join(".devcontainer", "Dockerfile"),
          "devcontainer dockerfile",
        ),
        resolveSafePath(
          workspaceRoot,
          path.join(".devcontainer", "bootstrap.sh"),
          "devcontainer bootstrap",
        ),
      ]) {
        if (!(await pathExists(requiredPath))) {
          report.status = escalateStatus(report.status, "warning");
          report.issues.push({
            code: "DEVCONTAINER_ARTIFACT_MISSING",
            message: "DevContainer artifact is missing.",
            path: requiredPath,
          });
        }
      }
    }

    const hookIssues = await runPackHooks(resolvedWorkspace, "validate", false, true);
    if (hookIssues.length > 0) {
      report.status = escalateStatus(report.status, "warning");
      report.issues.push(...hookIssues);
    }
  } catch (error) {
    report.status = "error";
    const maestroError = new MaestroError({
      code: "DOCTOR_FAILED",
      message: "Doctor command failed.",
      cause: error,
    });
    report.issues.push({
      code: "DOCTOR_FAILED",
      message: errorMessage(maestroError),
    });
  }

  await withWorkspaceLock(workspaceRoot, async () => {
    const reportPath = resolveSafePath(
      workspaceRoot,
      path.join(workspaceStateDirName, "reports", "doctor-report.json"),
      "doctor report path",
    );
    await writeJson(reportPath, report);
  });

  return report;
}
