import type { PolicyEvaluator } from "../../policy/types.js";
import { AllowedPathsPolicy } from "./allowed-paths-policy.js";
import { BranchNamingPolicy } from "./branch-naming-policy.js";
import { DiffSizeLimitPolicy } from "./diff-size-limit-policy.js";
import { ForbiddenPathsPolicy } from "./no-source-changes-in-ops-policy.js";

export function createBuiltInPolicyEvaluators(): PolicyEvaluator[] {
  return [
    new AllowedPathsPolicy(),
    new ForbiddenPathsPolicy(),
    new DiffSizeLimitPolicy(),
    new BranchNamingPolicy(),
  ];
}
