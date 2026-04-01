const VERBOSE_ERROR_ENV_KEYS = ["MAESTRO_VERBOSE", "MAESTRO_VERBOSE_ERRORS"] as const;
const VERBOSE_ERROR_ENV_TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

export function isVerboseErrorMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return VERBOSE_ERROR_ENV_KEYS.some((key) => {
    const value = env[key];
    return (
      typeof value === "string" && VERBOSE_ERROR_ENV_TRUE_VALUES.has(value.trim().toLowerCase())
    );
  });
}

export function formatUnhandledCliError(
  error: unknown,
  options: { showStack?: boolean } = {},
): string {
  if (error instanceof Error) {
    if (options.showStack && error.stack) {
      return `${error.stack}\n`;
    }

    return `${error.message}\n`;
  }

  return `${String(error)}\n`;
}
