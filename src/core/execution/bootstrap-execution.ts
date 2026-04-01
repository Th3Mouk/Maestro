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
    skipped: entry.skipped,
  }));
}

export async function executeBootstrapPlan(
  entries: RepositoryBootstrapPlan[],
  options: ExecuteBootstrapPlanOptions,
): Promise<BootstrapReport["issues"]> {
  if (options.dryRun) {
    return [];
  }

  const outcomes = await mapWithConcurrency(entries, options.concurrencyLimit, async (entry) => {
    if (entry.skipped) {
      return { issue: undefined };
    }

    for (const command of entry.commands) {
      try {
        await options.runCommand(entry, command);
      } catch (error) {
        return {
          issue: {
            code: "BOOTSTRAP_COMMAND_FAILED",
            message: buildBootstrapFailureMessage(entry.repository.name, command, error),
            path: entry.repoRoot,
          },
        };
      }
    }

    return { issue: undefined };
  });

  const issues: BootstrapReport["issues"] = [];
  for (const outcome of outcomes) {
    if (outcome.issue) {
      issues.push(outcome.issue);
    }
  }
  return issues;
}
