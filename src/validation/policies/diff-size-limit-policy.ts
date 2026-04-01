import type {
  PolicyEvaluationInput,
  PolicyEvaluationResult,
  PolicyEvaluator,
} from "../../policy/types.js";
import type { ResolvedPolicy } from "../../workspace/types.js";
import { parseDiffThreshold } from "./helpers.js";

export class DiffSizeLimitPolicy implements PolicyEvaluator {
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
