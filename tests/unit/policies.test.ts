import { describe, expect, test } from "vitest";
import type { PolicyEvaluationInput } from "../../src/policy/types.js";
import type {
  RepositoryRef,
  ResolvedPolicy,
  ResolvedWorkspace,
} from "../../src/workspace/types.js";
import { getRepositorySparseIncludePaths } from "../../src/workspace/repositories.js";
import { createBuiltInPolicyEvaluators, evaluatePolicies } from "../../src/validation/policies.js";

function createInput(overrides: Partial<PolicyEvaluationInput> = {}): PolicyEvaluationInput {
  const repository: RepositoryRef = {
    name: "sur-api",
    remote: "git@github.com:org/sur-api.git",
    branch: "main",
    sparse: {
      visiblePaths: [".github/", "deploy/"],
    },
    permissions: {
      writablePaths: [".github/**"],
      forbiddenPaths: ["src/**"],
    },
  };

  const workspace = {
    workspaceRoot: "/tmp/workspace",
    manifest: {
      apiVersion: "maestro/v1",
      kind: "Workspace",
      metadata: { name: "ops-workspace" },
      spec: {
        runtimes: {},
        repositories: [repository],
      },
    },
    packs: [],
    repositories: [repository],
    execution: {},
    runtimes: {},
    plugins: {},
    selectedAgents: { codex: [], "claude-code": [], opencode: [] },
    selectedSkills: [],
    mcpServers: [],
    selectedPolicies: [],
    lockfile: {
      frameworkVersion: "0.1.0",
      generatedAt: new Date().toISOString(),
      packs: [],
      repositories: [
        {
          name: repository.name,
          branch: repository.branch ?? "main",
          sparsePaths: getRepositorySparseIncludePaths(repository),
        },
      ],
    },
  } satisfies ResolvedWorkspace;

  return {
    workspace,
    repository,
    repoRoot: "/tmp/workspace/repos/sur-api",
    changedFiles: [".github/workflows/deploy.yml"],
    branchName: "chore/normalize-permissions",
    diffStats: { files: 1, added: 4, deleted: 1 },
    ...overrides,
  };
}

function policy(name: string, spec: Record<string, unknown>): ResolvedPolicy {
  return { name, source: "manifest", spec };
}

describe("built-in policies", () => {
  test("allows writable paths from repository permissions by default", async () => {
    const result = await evaluatePolicies(
      createInput(),
      [policy("allowed-paths", {})],
      createBuiltInPolicyEvaluators(),
    );

    expect(result).toEqual({ success: true });
  });

  test("rejects files outside writable scope", async () => {
    const result = await evaluatePolicies(
      createInput({ changedFiles: ["src/Secret.php"] }),
      [policy("allowed-paths", { writable: [".github/**"] })],
      createBuiltInPolicyEvaluators(),
    );

    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.code).toBe("PATH_NOT_ALLOWED");
  });

  test("rejects forbidden paths from repository permissions", async () => {
    const result = await evaluatePolicies(
      createInput({ changedFiles: ["src/Secret.php"] }),
      [policy("no-source-changes-in-ops", {})],
      createBuiltInPolicyEvaluators(),
    );

    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.code).toBe("PATH_FORBIDDEN");
  });

  test("aggregates diff-size and branch naming failures", async () => {
    const result = await evaluatePolicies(
      createInput({
        branchName: "feature/bad-name",
        diffStats: { files: 5, added: 15, deleted: 9 },
      }),
      [
        policy("diff-size-limit", { maxChangedFiles: 1, maxAddedLines: 3, maxDeletedLines: 2 }),
        policy("branch-naming", { pattern: "^chore/" }),
      ],
      createBuiltInPolicyEvaluators(),
    );

    expect(result.success).toBe(false);
    expect(result.errors?.map((entry) => entry.code)).toEqual([
      "DIFF_TOO_WIDE",
      "DIFF_TOO_MANY_ADDS",
      "DIFF_TOO_MANY_DELETES",
      "BRANCH_NAME_INVALID",
    ]);
  });

  test("rejects unsafe branch naming patterns", async () => {
    const result = await evaluatePolicies(
      createInput({
        branchName: "chore/safe",
      }),
      [policy("branch-naming", { pattern: "^(a+)+$" })],
      createBuiltInPolicyEvaluators(),
    );

    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.code).toBe("BRANCH_PATTERN_UNSAFE");
  });

  test("rejects invalid branch naming patterns", async () => {
    const result = await evaluatePolicies(
      createInput({
        branchName: "chore/safe",
      }),
      [policy("branch-naming", { pattern: "(" })],
      createBuiltInPolicyEvaluators(),
    );

    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.code).toBe("BRANCH_PATTERN_INVALID");
  });

  test("rejects NaN maxChangedFiles threshold", async () => {
    const result = await evaluatePolicies(
      createInput(),
      [policy("diff-size-limit", { maxChangedFiles: "not-a-number" })],
      createBuiltInPolicyEvaluators(),
    );

    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.code).toBe("DIFF_LIMIT_INVALID_NUMBER");
  });

  test("rejects NaN maxAddedLines threshold", async () => {
    const result = await evaluatePolicies(
      createInput(),
      [policy("diff-size-limit", { maxAddedLines: "not-a-number" })],
      createBuiltInPolicyEvaluators(),
    );

    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.code).toBe("DIFF_LIMIT_INVALID_NUMBER");
  });

  test("rejects NaN maxDeletedLines threshold", async () => {
    const result = await evaluatePolicies(
      createInput(),
      [policy("diff-size-limit", { maxDeletedLines: "not-a-number" })],
      createBuiltInPolicyEvaluators(),
    );

    expect(result.success).toBe(false);
    expect(result.errors?.[0]?.code).toBe("DIFF_LIMIT_INVALID_NUMBER");
  });
});
