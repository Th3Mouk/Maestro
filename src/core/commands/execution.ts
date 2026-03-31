import {
  bootstrapWorkspace as bootstrapWorkspaceExecution,
  prepareTaskWorktree,
} from "../execution-service.js";
import type { CommandContext } from "../command-context.js";
import { createCommandContext } from "../command-context.js";

export interface LoopProgressReporter {
  complete: () => void;
  itemCompleted: () => void;
  itemStarted: (label: string, index: number) => void;
  phase: (message: string) => void;
}

export function createLoopProgressReporter(
  stream: NodeJS.WriteStream,
  operation: string,
  total: number,
): LoopProgressReporter {
  let completed = 0;

  const writeLine = (message: string) => {
    stream.write(`[maestro] ${operation}: ${message}\n`);
  };

  return {
    itemStarted: (label, index) => {
      writeLine(`[${index + 1}/${total}] start ${label}`);
    },
    itemCompleted: () => {
      completed += 1;
      writeLine(`completed ${completed}/${total}`);
    },
    phase: (message) => {
      writeLine(message);
    },
    complete: () => {
      writeLine(`done (${completed}/${total})`);
    },
  };
}

export async function bootstrapWorkspace(
  workspaceRoot: string,
  options: { repository?: string; dryRun?: boolean } = {},
) {
  return bootstrapWorkspaceExecution(workspaceRoot, options);
}

export async function createTaskWorktree(
  workspaceRoot: string,
  taskName: string,
  options: { dryRun?: boolean } = {},
  context: CommandContext = createCommandContext(),
) {
  return prepareTaskWorktree(workspaceRoot, taskName, options, {
    gitAdapter: context.gitAdapter,
  });
}
