import path from "node:path";
import type { DoctorReport } from "../../report/types.js";
import type { RuntimeName } from "../../runtime/types.js";
import { pathExists, resolveSafePath } from "../../utils/fs.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import { pushDoctorWarning } from "./reporting.js";

function getRequiredRuntimePaths(
  workspaceRoot: string,
  runtime: RuntimeName,
  mcpServerCount: number,
): string[] {
  if (runtime === "codex") {
    return [resolveSafePath(workspaceRoot, path.join(".codex", "config.toml"), "codex config")];
  }

  if (runtime === "claude-code") {
    return [
      resolveSafePath(workspaceRoot, "CLAUDE.md", "claude instructions"),
      resolveSafePath(workspaceRoot, path.join(".claude", "settings.json"), "claude settings"),
      ...(mcpServerCount > 0
        ? [resolveSafePath(workspaceRoot, ".mcp.json", "claude mcp config")]
        : []),
    ];
  }

  return [
    resolveSafePath(workspaceRoot, path.join(".opencode", "opencode.json"), "opencode config"),
  ];
}

export async function runRuntimeArtifactChecks(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  report: DoctorReport,
): Promise<void> {
  for (const runtime of Object.keys(resolvedWorkspace.runtimes) as RuntimeName[]) {
    for (const requiredPath of getRequiredRuntimePaths(
      workspaceRoot,
      runtime,
      resolvedWorkspace.mcpServers.length,
    )) {
      if (!(await pathExists(requiredPath))) {
        pushDoctorWarning(report, {
          code: "RUNTIME_ARTIFACT_MISSING",
          message: `Runtime artifact is missing for ${runtime}.`,
          path: requiredPath,
        });
      }
    }
  }
}
