import type { RepositoryRef, ResolvedPolicy, ResolvedWorkspace } from "../workspace/types.js";

export interface PolicyEvaluationInput {
  workspace: ResolvedWorkspace;
  repository: RepositoryRef;
  repoRoot: string;
  changedFiles: string[];
  branchName?: string;
  diffStats?: {
    files: number;
    added: number;
    deleted: number;
  };
}

export interface PolicyEvaluationResult {
  success: boolean;
  errors?: Array<{
    code: string;
    message: string;
    path?: string;
  }>;
}

export interface PolicyEvaluator {
  name: string;
  evaluate(input: PolicyEvaluationInput, policy: ResolvedPolicy): Promise<PolicyEvaluationResult>;
}

export interface ValidatorRegistry {
  register(validator: PolicyEvaluator): void;
  list(): PolicyEvaluator[];
}
