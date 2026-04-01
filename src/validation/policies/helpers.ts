export function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function parseDiffThreshold(
  rawValue: unknown,
  fieldName: "maxChangedFiles" | "maxAddedLines" | "maxDeletedLines",
):
  | { value: number; error?: undefined }
  | {
      value?: undefined;
      error: { code: "DIFF_LIMIT_INVALID_NUMBER"; message: string };
    } {
  if (rawValue === undefined || rawValue === null) {
    return { value: Number.POSITIVE_INFINITY };
  }

  const value = Number(rawValue);
  if (Number.isNaN(value)) {
    return {
      error: {
        code: "DIFF_LIMIT_INVALID_NUMBER",
        message: `Invalid numeric threshold for ${fieldName}.`,
      },
    };
  }

  return { value };
}
