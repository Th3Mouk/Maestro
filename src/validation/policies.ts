import picomatch from "picomatch";
import safeRegex from "safe-regex2";
import type {
  PolicyEvaluationInput,
  PolicyEvaluationResult,
  PolicyEvaluator,
} from "../policy/types.js";
import type { ResolvedPolicy } from "../workspace/types.js";

class AllowedPathsPolicy implements PolicyEvaluator {
  name = "allowed-paths";

  async evaluate(
    input: PolicyEvaluationInput,
    policy: ResolvedPolicy,
  ): Promise<PolicyEvaluationResult> {
    const writablePatterns = toStringArray(
      policy.spec.writable ?? input.repository.permissions?.writablePaths ?? [],
    );
    if (writablePatterns.length === 0) {
      return { success: true };
    }

    const invalid = input.changedFiles.filter(
      (filePath) => !writablePatterns.some((pattern) => picomatch.isMatch(filePath, pattern)),
    );
    return invalid.length === 0
      ? { success: true }
      : {
          success: false,
          errors: invalid.map((entry) => ({
            code: "PATH_NOT_ALLOWED",
            message: `File ${entry} is outside the writable scope.`,
            path: entry,
          })),
        };
  }
}

class ForbiddenPathsPolicy implements PolicyEvaluator {
  name = "no-source-changes-in-ops";

  async evaluate(
    input: PolicyEvaluationInput,
    policy: ResolvedPolicy,
  ): Promise<PolicyEvaluationResult> {
    const forbiddenPatterns = toStringArray(
      policy.spec.forbidden ?? input.repository.permissions?.forbiddenPaths ?? [],
    );
    const invalid = input.changedFiles.filter((filePath) =>
      forbiddenPatterns.some((pattern) => picomatch.isMatch(filePath, pattern)),
    );
    return invalid.length === 0
      ? { success: true }
      : {
          success: false,
          errors: invalid.map((entry) => ({
            code: "PATH_FORBIDDEN",
            message: `File ${entry} matches a forbidden path.`,
            path: entry,
          })),
        };
  }
}

class DiffSizeLimitPolicy implements PolicyEvaluator {
  name = "diff-size-limit";

  async evaluate(
    input: PolicyEvaluationInput,
    policy: ResolvedPolicy,
  ): Promise<PolicyEvaluationResult> {
    const stats = input.diffStats ?? { files: 0, added: 0, deleted: 0 };
    const maxFiles = parseDiffThreshold(policy.spec.maxChangedFiles, "maxChangedFiles");
    if (maxFiles.error) {
      return { success: false, errors: [maxFiles.error] };
    }

    const maxAdded = parseDiffThreshold(policy.spec.maxAddedLines, "maxAddedLines");
    if (maxAdded.error) {
      return { success: false, errors: [maxAdded.error] };
    }

    const maxDeleted = parseDiffThreshold(policy.spec.maxDeletedLines, "maxDeletedLines");
    if (maxDeleted.error) {
      return { success: false, errors: [maxDeleted.error] };
    }

    const errors = [];
    if (stats.files > maxFiles.value) {
      errors.push({
        code: "DIFF_TOO_WIDE",
        message: `Too many modified files (${stats.files} > ${maxFiles.value}).`,
      });
    }
    if (stats.added > maxAdded.value) {
      errors.push({
        code: "DIFF_TOO_MANY_ADDS",
        message: `Too many added lines (${stats.added} > ${maxAdded.value}).`,
      });
    }
    if (stats.deleted > maxDeleted.value) {
      errors.push({
        code: "DIFF_TOO_MANY_DELETES",
        message: `Too many deleted lines (${stats.deleted} > ${maxDeleted.value}).`,
      });
    }

    return errors.length === 0 ? { success: true } : { success: false, errors };
  }
}

class BranchNamingPolicy implements PolicyEvaluator {
  name = "branch-naming";

  async evaluate(
    input: PolicyEvaluationInput,
    policy: ResolvedPolicy,
  ): Promise<PolicyEvaluationResult> {
    const pattern = String(policy.spec.pattern ?? "");
    if (!pattern || !input.branchName) {
      return { success: true };
    }

    let matcher: RegExp;
    try {
      matcher = new RegExp(pattern);
    } catch {
      return {
        success: false,
        errors: [
          {
            code: "BRANCH_PATTERN_INVALID",
            message: `Branch naming pattern is invalid: ${pattern}`,
          },
        ],
      };
    }

    if (!safeRegex(matcher) || pattern.length > 256) {
      return {
        success: false,
        errors: [
          {
            code: "BRANCH_PATTERN_UNSAFE",
            message: "Branch naming pattern is unsafe or too complex.",
          },
        ],
      };
    }

    const isValid = matcher.test(input.branchName);
    return isValid
      ? { success: true }
      : {
          success: false,
          errors: [
            {
              code: "BRANCH_NAME_INVALID",
              message: `Branch ${input.branchName} does not match ${pattern}.`,
            },
          ],
        };
  }
}

export function createBuiltInPolicyEvaluators(): PolicyEvaluator[] {
  return [
    new AllowedPathsPolicy(),
    new ForbiddenPathsPolicy(),
    new DiffSizeLimitPolicy(),
    new BranchNamingPolicy(),
  ];
}

export async function evaluatePolicies(
  input: PolicyEvaluationInput,
  policies: ResolvedPolicy[],
  evaluators: PolicyEvaluator[],
): Promise<PolicyEvaluationResult> {
  const errors: NonNullable<PolicyEvaluationResult["errors"]> = [];

  for (const policy of policies) {
    const evaluator = evaluators.find((candidate) => candidate.name === policy.name);
    if (!evaluator) {
      continue;
    }

    const result = await evaluator.evaluate(input, policy);
    if (!result.success && result.errors) {
      errors.push(...result.errors);
    }
  }

  return errors.length === 0 ? { success: true } : { success: false, errors };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function parseDiffThreshold(
  rawValue: unknown,
  fieldName: "maxChangedFiles" | "maxAddedLines" | "maxDeletedLines",
):
  | { value: number; error?: undefined }
  | {
      value?: undefined;
      error: { code: "DIFF_LIMIT_INVALID_NUMBER"; message: string };
    } {
  if (rawValue === undefined || rawValue === null) {
    return { value: Number.POSITIVE_INFINITY };
  }

  const value = Number(rawValue);
  if (Number.isNaN(value)) {
    return {
      error: {
        code: "DIFF_LIMIT_INVALID_NUMBER",
        message: `Invalid numeric threshold for ${fieldName}.`,
      },
    };
  }

  return { value };
}
