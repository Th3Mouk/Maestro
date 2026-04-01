import { describe, expect, test } from "vitest";
import { createTaskBranchName, sanitizeSegment } from "../../src/core/execution/task-worktree.js";

describe("task worktree naming", () => {
  test("sanitizes user inputs into git-safe segments", () => {
    expect(sanitizeSegment("Feature / ABC")).toBe("feature-abc");
    expect(sanitizeSegment("---Feature / ABC---")).toBe("feature-abc");
    expect(sanitizeSegment("___")).toBe("___");
  });

  test("falls back to default segment when value is empty after sanitization", () => {
    expect(sanitizeSegment("///")).toBe("task");
  });

  test("builds task branches from independently sanitized segments", () => {
    expect(createTaskBranchName("Task", "---Feature / ABC---", "Repo_API")).toBe(
      "task/feature-abc/repo_api",
    );
  });
});
