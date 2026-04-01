import type { RuntimeName } from "../../../runtime/types.js";

export function parseRuntimeNames(value?: string): RuntimeName[] | undefined {
  if (!value) {
    return undefined;
  }

  const supportedRuntimeNames: RuntimeName[] = ["codex", "claude-code", "opencode"];
  const runtimes = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  const invalidRuntimeNames = runtimes.filter(
    (runtime): runtime is string => !supportedRuntimeNames.includes(runtime as RuntimeName),
  );
  if (invalidRuntimeNames.length > 0) {
    throw new Error(
      `Unsupported runtime(s): ${invalidRuntimeNames.join(", ")}. Supported values: ${supportedRuntimeNames.join(", ")}`,
    );
  }

  return runtimes.length > 0 ? Array.from(new Set(runtimes as RuntimeName[])) : undefined;
}

export function writeJsonStdout(value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
