import type { Command } from "commander";
import type { CommandContext } from "./commands/command-types.js";
import { registerEditorWorkspaceCommand } from "./commands/register-editor-workspace-command.js";
import { registerInitCommand } from "./commands/register-init-command.js";
import { registerRepoCommand } from "./commands/register-repo-command.js";
import { registerSelfCommand } from "./commands/register-self-command.js";
import { registerWorkspaceCommand } from "./commands/register-workspace-command.js";
import { registerWorktreeCommand } from "./commands/register-worktree-command.js";

export function registerProgramCommands(program: Command, commandContext: CommandContext): void {
  registerInitCommand(program);
  registerWorkspaceCommand(program, commandContext);
  registerRepoCommand(program, commandContext);
  registerWorktreeCommand(program, commandContext);
  registerEditorWorkspaceCommand(program);
  registerSelfCommand(program);
}
