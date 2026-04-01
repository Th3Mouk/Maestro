function trimEdgeCharacters(value: string, character: string): string {
  let start = 0;
  let end = value.length;

  while (start < end && value[start] === character) {
    start += 1;
  }

  while (end > start && value[end - 1] === character) {
    end -= 1;
  }

  return value.slice(start, end);
}

export function sanitizeSegment(value: string): string {
  const normalized = value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
  const trimmed = trimEdgeCharacters(normalized, "-");
  return trimmed || "task";
}

export function createTaskBranchName(
  branchPrefix: string | undefined,
  taskName: string,
  scope: string,
): string {
  const prefix = sanitizeSegment(branchPrefix ?? "task");
  const sanitizedTaskName = sanitizeSegment(taskName);
  return `${prefix}/${sanitizedTaskName}/${sanitizeSegment(scope)}`;
}
