import { execa } from "execa";
import type { WorktreeExecution } from "../../workspace/types.js";

type ListColumn = NonNullable<WorktreeExecution["listColumns"]>[number];

/** The value shown when a column command failed or ran out of time. */
const unknownValue = "?";

const DEFAULT_COLUMN_TIMEOUT_MS = 5_000;

/**
 * Runs each `listColumns` command once, concurrently, from the main workspace root, with the
 * task names on stdin (one per line, `@root` first). A command prints `task<TAB>value` lines;
 * one that fails or exceeds the timeout gets `?` for every task and a warning.
 */
export async function runListColumns(
  columns: ListColumn[],
  options: { taskNames: string[]; timeoutMs?: number; workspaceRoot: string },
): Promise<{
  issues: Array<{ code: string; message: string }>;
  values: Map<string, Record<string, string>>;
}> {
  const values = new Map<string, Record<string, string>>(
    options.taskNames.map((name) => [name, {}]),
  );
  const issues: Array<{ code: string; message: string }> = [];
  const timeoutMs = options.timeoutMs ?? DEFAULT_COLUMN_TIMEOUT_MS;

  await Promise.all(
    columns.map(async (column) => {
      const result = await execa("sh", ["-c", column.command], {
        cwd: options.workspaceRoot,
        env: { MAESTRO_WORKSPACE_ROOT: options.workspaceRoot },
        input: `${options.taskNames.join("\n")}\n`,
        reject: false,
        timeout: timeoutMs,
      });

      let byTask = new Map<string, string>();
      if (result.timedOut) {
        issues.push({
          code: "LIST_COLUMN_TIMEOUT",
          message: `List column "${column.name}" (\`${column.command}\`) took longer than ${timeoutMs / 1000} s and was stopped.`,
        });
      } else if (result.exitCode !== 0) {
        issues.push({
          code: "LIST_COLUMN_FAILED",
          message: `List column "${column.name}" (\`${column.command}\`) failed (exit ${result.exitCode}).`,
        });
      } else {
        byTask = parseColumnOutput(String(result.stdout));
      }

      const failed = result.timedOut || result.exitCode !== 0;
      for (const [task, row] of values) {
        row[column.name] = failed ? unknownValue : (byTask.get(task) ?? "-");
      }
    }),
  );

  return { issues, values };
}

function parseColumnOutput(stdout: string): Map<string, string> {
  const byTask = new Map<string, string>();
  for (const line of stdout.split("\n")) {
    const separator = line.indexOf("\t");
    if (separator > 0) {
      byTask.set(line.slice(0, separator), line.slice(separator + 1).trim());
    }
  }
  return byTask;
}
