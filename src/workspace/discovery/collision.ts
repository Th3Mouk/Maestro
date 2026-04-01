import type { ConflictStrategy } from "../types.js";

export function resolvePackCollision<T>(
  matches: T[],
  strategy: ConflictStrategy["strategy"] | undefined,
  missingStrategyError: string,
): T | undefined {
  if (matches.length > 1) {
    if (!strategy) {
      throw new Error(missingStrategyError);
    }

    return strategy === "prefer-pack-last" ? matches.at(-1)! : matches[0];
  }

  return matches[0];
}
