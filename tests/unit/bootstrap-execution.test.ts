import { describe, expect, test, vi } from "vitest";
import {
  createBootstrapRepositoryReport,
  executeBootstrapPlan,
  selectBootstrapPlanEntries,
} from "../../src/core/execution/bootstrap-execution.js";
import type { RepositoryBootstrapPlan } from "../../src/core/execution/bootstrap-plan.js";
import { createRepositoryFixture } from "../utils/execution-fixtures.js";

function createBootstrapPlanEntry(
  overrides: Partial<RepositoryBootstrapPlan> &
    Pick<RepositoryBootstrapPlan, "repository" | "repoPathFromWorkspaceRoot">,
): RepositoryBootstrapPlan {
  return {
    commands: ["npm ci"],
    issues: [],
    repoRoot: `/tmp/${overrides.repository.name}`,
    skipped: false,
    toolchains: [],
    ...overrides,
  };
}

describe("bootstrap execution", () => {
  test("selects all repositories when no repository filter is provided", () => {
    const plan = [
      createBootstrapPlanEntry({
        repository: createRepositoryFixture({ name: "frontend" }),
        repoPathFromWorkspaceRoot: "repos/frontend",
      }),
      createBootstrapPlanEntry({
        repository: createRepositoryFixture({ name: "backend" }),
        repoPathFromWorkspaceRoot: "repos/backend",
      }),
    ];

    const selection = selectBootstrapPlanEntries(plan);

    expect(selection.issue).toBeUndefined();
    expect(selection.entries).toHaveLength(2);
  });

  test("returns a not-found issue when the repository filter has no match", () => {
    const plan = [
      createBootstrapPlanEntry({
        repository: createRepositoryFixture({ name: "frontend" }),
        repoPathFromWorkspaceRoot: "repos/frontend",
      }),
    ];

    const selection = selectBootstrapPlanEntries(plan, "missing-repository");

    expect(selection.entries).toHaveLength(0);
    expect(selection.issue).toMatchObject({
      code: "REPOSITORY_NOT_FOUND",
      message: "Repository not found: missing-repository",
    });
  });

  test("projects bootstrap repositories into report entries", () => {
    const entries = [
      createBootstrapPlanEntry({
        commands: ["npm ci"],
        repository: createRepositoryFixture({ name: "frontend" }),
        repoPathFromWorkspaceRoot: "repos/frontend",
        skipped: false,
      }),
      createBootstrapPlanEntry({
        commands: [],
        repository: createRepositoryFixture({ name: "backend" }),
        repoPathFromWorkspaceRoot: "repos/backend",
        skipped: true,
      }),
    ];

    expect(createBootstrapRepositoryReport(entries)).toEqual([
      { commands: ["npm ci"], name: "frontend", state: "executed" },
      { commands: [], name: "backend", state: "skipped" },
    ]);
  });

  test("skips command execution on dry runs and skipped entries", async () => {
    const runCommand = vi.fn<(entry: RepositoryBootstrapPlan, command: string) => Promise<void>>(
      async () => undefined,
    );
    const entries = [
      createBootstrapPlanEntry({
        repository: createRepositoryFixture({ name: "frontend" }),
        repoPathFromWorkspaceRoot: "repos/frontend",
      }),
      createBootstrapPlanEntry({
        repository: createRepositoryFixture({ name: "backend" }),
        repoPathFromWorkspaceRoot: "repos/backend",
        skipped: true,
      }),
    ];

    const dryRun = await executeBootstrapPlan(entries, {
      concurrencyLimit: 2,
      dryRun: true,
      runCommand,
    });

    expect(dryRun.issues).toEqual([]);
    expect(dryRun.failedRepositoryNames.size).toBe(0);
    expect(runCommand).not.toHaveBeenCalled();

    const result = await executeBootstrapPlan(entries, {
      concurrencyLimit: 2,
      runCommand,
    });

    expect(result.issues).toEqual([]);
    expect(result.failedRepositoryNames.size).toBe(0);
    expect(runCommand).toHaveBeenCalledTimes(1);
  });

  test("returns actionable issue details and the failed repository name when a command fails", async () => {
    const entry = createBootstrapPlanEntry({
      commands: ["npm ci"],
      repository: createRepositoryFixture({ name: "sur-api" }),
      repoPathFromWorkspaceRoot: "repos/sur-api",
    });

    const result = await executeBootstrapPlan([entry], {
      concurrencyLimit: 1,
      runCommand: async () => {
        throw new Error("npm: command not found");
      },
    });

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe("BOOTSTRAP_COMMAND_FAILED");
    expect(result.issues[0]?.message).toContain("Bootstrap command failed for sur-api");
    expect(result.issues[0]?.message).toContain("command: npm ci");
    expect(result.issues[0]?.message).toContain("npm: command not found");
    expect(result.issues[0]?.path).toBe(entry.repoRoot);
    expect(result.failedRepositoryNames).toEqual(new Set(["sur-api"]));
  });
});
