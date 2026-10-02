import { execa } from "execa";
import type { WorktreeHookRun } from "../../report/types.js";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import { errorMessage } from "../errors.js";

type WorktreeHookName = WorktreeHookRun["hook"];
export type WorktreeHookTrigger = "create" | "remove" | "prune";

interface WorktreeHookCommand {
  command: string;
  /** Set for a pack hook, exported as `MAESTRO_PACK_ROOT`. */
  packRoot?: string;
}

interface WorktreeHookTask {
  name: string;
  repositories: string[];
  root: string;
}

interface RunWorktreeHooksOptions {
  hook: WorktreeHookName;
  stderr: NodeJS.WritableStream;
  task: WorktreeHookTask;
  trigger: WorktreeHookTrigger;
  workspaceRoot: string;
}

interface WorktreeHookFailure {
  command: string;
  exitCode: number;
  message: string;
}

const packHookKeys = {
  postCreate: "worktreePostCreate",
  preRemove: "worktreePreRemove",
} as const;

const STDERR_TAIL_LINES = 5;

/** Pack hooks first, in pack order, then the manifest hooks, each in declaration order. */
export function listWorktreeHookCommands(
  resolvedWorkspace: ResolvedWorkspace,
  hook: WorktreeHookName,
): WorktreeHookCommand[] {
  const packCommands = resolvedWorkspace.packs.flatMap((pack) =>
    (pack.manifest.spec.provides?.hooks?.[packHookKeys[hook]] ?? []).map((command) => ({
      command,
      packRoot: pack.root,
    })),
  );
  const manifestCommands = (resolvedWorkspace.execution.worktrees?.hooks?.[hook] ?? []).map(
    (command) => ({ command }),
  );
  return [...packCommands, ...manifestCommands];
}

export function planWorktreeHooks(
  commands: WorktreeHookCommand[],
  hook: WorktreeHookName,
  task?: string,
): WorktreeHookRun[] {
  return commands.map(({ command }) => ({
    hook,
    command,
    status: "planned" as const,
    ...(task ? { task } : {}),
  }));
}

/**
 * Runs the commands one after the other with `sh -c` from the main workspace root, and stops
 * at the first failure. Their output goes to stderr, prefixed with the hook name, so a
 * `--json` report on stdout stays parseable.
 */
export async function runWorktreeHooks(
  commands: WorktreeHookCommand[],
  options: RunWorktreeHooksOptions,
): Promise<{ failure?: WorktreeHookFailure; runs: WorktreeHookRun[] }> {
  const runs: WorktreeHookRun[] = [];
  for (const { command, packRoot } of commands) {
    const result = await runHookCommand(command, packRoot, options);
    runs.push({
      hook: options.hook,
      command,
      status: result.exitCode === 0 ? "ok" : "failed",
      exitCode: result.exitCode,
      ...(options.trigger === "prune" ? { task: options.task.name } : {}),
    });
    if (result.exitCode !== 0) {
      const tail = result.stderrLines.slice(-STDERR_TAIL_LINES).join("\n");
      return {
        runs,
        failure: {
          command,
          exitCode: result.exitCode,
          message: `${options.hook} hook \`${command}\` failed (exit ${result.exitCode})${tail ? `:\n${tail}` : "."}`,
        },
      };
    }
  }
  return { runs };
}

async function runHookCommand(
  command: string,
  packRoot: string | undefined,
  options: RunWorktreeHooksOptions,
): Promise<{ exitCode: number; stderrLines: string[] }> {
  const stderrLines: string[] = [];
  const prefix = `[${options.hook}] `;
  const forward = (stream: NodeJS.ReadableStream | null, keep: boolean) => {
    let pending = "";
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => {
      const lines = (pending + chunk).split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        options.stderr.write(`${prefix}${line}\n`);
        if (keep) {
          stderrLines.push(line);
        }
      }
    });
    stream?.on("end", () => {
      if (pending) {
        options.stderr.write(`${prefix}${pending}\n`);
        if (keep) {
          stderrLines.push(pending);
        }
      }
    });
  };

  try {
    const subprocess = execa("sh", ["-c", command], {
      cwd: options.workspaceRoot,
      env: {
        MAESTRO_HOOK: options.hook,
        MAESTRO_TASK: options.task.name,
        MAESTRO_TASK_REPOSITORIES: options.task.repositories.join(" "),
        MAESTRO_TASK_ROOT: options.task.root,
        MAESTRO_TRIGGER: options.trigger,
        MAESTRO_WORKSPACE_ROOT: options.workspaceRoot,
        ...(packRoot ? { MAESTRO_PACK_ROOT: packRoot } : {}),
      },
      reject: false,
      stdin: "ignore",
      buffer: false,
    });
    forward(subprocess.stdout, false);
    forward(subprocess.stderr, true);
    const result = await subprocess;
    return { exitCode: result.exitCode ?? 1, stderrLines };
  } catch (error) {
    return { exitCode: 127, stderrLines: [...stderrLines, errorMessage(error)] };
  }
}
