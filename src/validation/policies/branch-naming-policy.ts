import safeRegex from "safe-regex2";
import type {
  PolicyEvaluationInput,
  PolicyEvaluationResult,
  PolicyEvaluator,
} from "../../policy/types.js";
import type { ResolvedPolicy } from "../../workspace/types.js";

export class BranchNamingPolicy implements PolicyEvaluator {
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
