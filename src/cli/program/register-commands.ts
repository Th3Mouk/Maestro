import type { Command } from "commander";
import type { CommandContext } from "./commands/command-types.js";
import { registerBootstrapCommand } from "./commands/register-bootstrap-command.js";
import { registerCodeWorkspaceCommand } from "./commands/register-code-workspace-command.js";
import { registerDoctorCommand } from "./commands/register-doctor-command.js";
import { registerGitCommand } from "./commands/register-git-command.js";
import { registerInitCommand } from "./commands/register-init-command.js";
import { registerInstallCommand } from "./commands/register-install-command.js";
import { registerSyncCommand } from "./commands/register-sync-command.js";
import { registerUpdateCommand } from "./commands/register-update-command.js";
import { registerUpgradeCommand } from "./commands/register-upgrade-command.js";
import { registerWorktreeCommand } from "./commands/register-worktree-command.js";

export function registerProgramCommands(program: Command, commandContext: CommandContext): void {
  registerInitCommand(program);
  registerInstallCommand(program, commandContext);
  registerBootstrapCommand(program);
  registerSyncCommand(program, commandContext);
  registerUpdateCommand(program, commandContext);
  registerUpgradeCommand(program);
  registerCodeWorkspaceCommand(program);
  registerWorktreeCommand(program, commandContext);
  registerDoctorCommand(program, commandContext);
  registerGitCommand(program, commandContext);
}
