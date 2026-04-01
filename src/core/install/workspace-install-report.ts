import type { InstallReport } from "../../report/types.js";

export function createInstallReport(workspace: string): InstallReport {
  return {
    status: "ok",
    workspace,
    actions: [],
    repositories: [],
    projectedRuntimes: [],
    issues: [],
  };
}

export function withRepositoryActions(
  report: InstallReport,
  repositories: Array<{ name: string; status: "created" | "updated" | "unchanged"; path: string }>,
): InstallReport {
  return {
    ...report,
    repositories: [...report.repositories, ...repositories],
    actions: [
      ...report.actions,
      ...repositories.map((repository) => `${repository.status}:${repository.name}`),
    ],
  };
}

export function withActions(report: InstallReport, actions: string[]): InstallReport {
  return {
    ...report,
    actions: [...report.actions, ...actions],
  };
}
