import type { RepositoryRef } from "./types.js";

export function getRepositorySparseIncludePaths(
  repository: Pick<RepositoryRef, "sparse">,
): string[] {
  return repository.sparse?.includePaths ?? repository.sparse?.visiblePaths ?? [];
}

export function getRepositorySparseExcludePaths(
  repository: Pick<RepositoryRef, "sparse">,
): string[] {
  return repository.sparse?.excludePaths ?? [];
}

export function hasRepositorySparseCheckout(repository: Pick<RepositoryRef, "sparse">): boolean {
  return Boolean(
    getRepositorySparseIncludePaths(repository).length ||
    getRepositorySparseExcludePaths(repository).length,
  );
}

export function buildRepositorySparseCheckoutPatterns(
  repository: Pick<RepositoryRef, "sparse">,
): string[] {
  const includePaths = getRepositorySparseIncludePaths(repository);
  const excludePaths = getRepositorySparseExcludePaths(repository);
  const includePatterns = includePaths.length > 0 ? includePaths : ["/*"];
  return [
    ...includePatterns,
    ...excludePaths.flatMap((pathEntry) => buildSparseExclusionPatterns(pathEntry)),
  ];
}

export function getRepositoryReferenceBranch(repository: Pick<RepositoryRef, "branch">): string {
  return repository.branch ?? "main";
}

function buildSparseExclusionPatterns(pathEntry: string): string[] {
  const normalizedPath = pathEntry.replace(/^\.?\//, "").replace(/^\/+/, "");
  if (normalizedPath.length === 0) {
    return [];
  }

  if (normalizedPath.endsWith("/")) {
    return [`!/${normalizedPath}`];
  }

  return [`!/${normalizedPath}`, `!/${normalizedPath}/**`];
}
