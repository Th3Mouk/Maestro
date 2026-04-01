import picomatch from "picomatch";
import type {
  PolicyEvaluationInput,
  PolicyEvaluationResult,
  PolicyEvaluator,
} from "../../policy/types.js";
import type { ResolvedPolicy } from "../../workspace/types.js";
import { toStringArray } from "./helpers.js";

export class ForbiddenPathsPolicy implements PolicyEvaluator {
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
