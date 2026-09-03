import type { BootstrapReport } from "../../report/types.js";
import { mapWithConcurrency } from "../../utils/fs.js";
import { buildBootstrapFailureMessage, type RepositoryBootstrapPlan } from "./bootstrap-plan.js";

type BootstrapCommandRunner = (entry: RepositoryBootstrapPlan, command: string) => Promise<void>;

interface ExecuteBootstrapPlanOptions {
  concurrencyLimit: number;
  dryRun?: boolean;
  runCommand: BootstrapCommandRunner;
}

interface BootstrapSelection {
  entries: RepositoryBootstrapPlan[];
  issue?: BootstrapReport["issues"][number];
}

export function selectBootstrapPlanEntries(
  plan: RepositoryBootstrapPlan[],
  repositoryName?: string,
): BootstrapSelection {
  if (!repositoryName) {
    return { entries: plan };
  }

  const entries = plan.filter((entry) => entry.repository.name === repositoryName);
  if (entries.length > 0) {
    return { entries };
  }

  return {
    entries: [],
    issue: {
      code: "REPOSITORY_NOT_FOUND",
      message: `Repository not found: ${repositoryName}`,
    },
  };
}

export function createBootstrapRepositoryReport(
  entries: RepositoryBootstrapPlan[],
): BootstrapReport["repositories"] {
  return entries.map((entry) => ({
    commands: entry.commands,
    name: entry.repository.name,
    state: entry.skipped ? "skipped" : "executed",
  }));
}

interface BootstrapExecutionResult {
  issues: BootstrapReport["issues"];
  failedRepositoryNames: Set<string>;
}

export async function executeBootstrapPlan(
  entries: RepositoryBootstrapPlan[],
  options: ExecuteBootstrapPlanOptions,
): Promise<BootstrapExecutionResult> {
  if (options.dryRun) {
    return { issues: [], failedRepositoryNames: new Set() };
  }

  const outcomes = await mapWithConcurrency(entries, options.concurrencyLimit, async (entry) => {
    const repositoryName = entry.repository.name;
    if (entry.skipped) {
      return { issue: undefined, repositoryName };
    }

    for (const command of entry.commands) {
      try {
        await options.runCommand(entry, command);
      } catch (error) {
        return {
          issue: {
            code: "BOOTSTRAP_COMMAND_FAILED",
            message: buildBootstrapFailureMessage(repositoryName, command, error),
            path: entry.repoRoot,
          },
          repositoryName,
        };
      }
    }

    return { issue: undefined, repositoryName };
  });

  const issues: BootstrapReport["issues"] = [];
  const failedRepositoryNames = new Set<string>();
  for (const outcome of outcomes) {
    if (outcome.issue) {
      issues.push(outcome.issue);
      failedRepositoryNames.add(outcome.repositoryName);
    }
  }
  return { issues, failedRepositoryNames };
}
