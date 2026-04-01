import picomatch from "picomatch";
import type {
  PolicyEvaluationInput,
  PolicyEvaluationResult,
  PolicyEvaluator,
} from "../../policy/types.js";
import type { ResolvedPolicy } from "../../workspace/types.js";
import { toStringArray } from "./helpers.js";

export class AllowedPathsPolicy implements PolicyEvaluator {
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
