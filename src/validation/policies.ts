import type {
  PolicyEvaluationInput,
  PolicyEvaluationResult,
  PolicyEvaluator,
} from "../policy/types.js";
import type { ResolvedPolicy } from "../workspace/types.js";
import { createBuiltInPolicyEvaluators } from "./policies/registry.js";
export { createBuiltInPolicyEvaluators } from "./policies/registry.js";

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
