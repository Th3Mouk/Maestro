import type { DoctorReport } from "../../report/types.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import type { CommandContext } from "../command-context.js";
import { resolveWorkspace } from "../workspace-service.js";
import { runExecutionArtifactChecks } from "./execution-artifact-checks.js";
import { runLockAndStateChecks } from "./lock-state-checks.js";
import { runPluginMarketplaceChecks } from "./plugin-marketplace-checks.js";
import { runRepositoryChecks } from "./repository-checks.js";
import { runRuntimeArtifactChecks } from "./runtime-artifact-checks.js";

interface DoctorPipelineState {
  workspaceRoot: string;
  context: CommandContext;
  report: DoctorReport;
  resolvedWorkspace?: ResolvedWorkspace;
}

type DoctorPipelineStep = (state: DoctorPipelineState) => Promise<void>;

function requireResolvedWorkspace(state: DoctorPipelineState): ResolvedWorkspace {
  if (!state.resolvedWorkspace) {
    throw new Error("Doctor diagnostics pipeline requires a resolved workspace.");
  }
  return state.resolvedWorkspace;
}

const doctorPipelineSteps: DoctorPipelineStep[] = [
  async (state) => {
    state.resolvedWorkspace = await resolveWorkspace(state.workspaceRoot);
    state.report.workspace = state.resolvedWorkspace.manifest.metadata.name;
  },
  async (state) => runLockAndStateChecks(state.workspaceRoot, state.report),
  async (state) =>
    runRepositoryChecks(
      state.workspaceRoot,
      requireResolvedWorkspace(state),
      state.context,
      state.report,
    ),
  async (state) =>
    runRuntimeArtifactChecks(state.workspaceRoot, requireResolvedWorkspace(state), state.report),
  async (state) => runPluginMarketplaceChecks(state.workspaceRoot, state.report),
  async (state) =>
    runExecutionArtifactChecks(state.workspaceRoot, requireResolvedWorkspace(state), state.report),
];

export async function runDoctorDiagnostics(
  workspaceRoot: string,
  context: CommandContext,
  report: DoctorReport,
): Promise<void> {
  const state: DoctorPipelineState = {
    workspaceRoot,
    context,
    report,
  };

  for (const step of doctorPipelineSteps) {
    await step(state);
  }
}
