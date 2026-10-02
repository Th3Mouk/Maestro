import { Argument, type Command } from "commander";
import {
  assertFunctionName,
  renderShellFunction,
  resolveShell,
  supportedShells,
  updateShellRcFile,
} from "../../../core/shell-init.js";

export function registerShellInitCommand(program: Command): void {
  program
    .command("shell-init")
    .summary("Print a shell function that cds into task worktrees")
    .description(
      [
        "Print the `mw` shell function: `mw <task>` runs `maestro worktree open <task>` and cds into the task root it prints, `mw` alone opens the picker, `mw -l` lists tasks, and `mw --prune …` prunes them.",
        "Load it from your rc file with the same line on every machine:",
        '  eval "$(maestro shell-init)"        # zsh, bash',
        "  maestro shell-init fish | source    # fish",
        "--install adds that line to the shell's rc file between markers; --uninstall removes it.",
      ].join("\n"),
    )
    .addArgument(
      new Argument("[shell]", "shell to target (default: basename of $SHELL)").choices([
        ...supportedShells,
      ]),
    )
    .option("--name <name>", "function name", "mw")
    .option("--install", "add the loading line to the shell's rc file (replaces a previous one)")
    .option("--uninstall", "remove the loading line from the shell's rc file")
    .action(
      async (
        requestedShell: string | undefined,
        options: { install?: boolean; name: string; uninstall?: boolean },
      ) => {
        try {
          const shell = resolveShell(requestedShell, process.env);
          assertFunctionName(options.name);
          if (options.install && options.uninstall) {
            throw new Error("Pass either --install or --uninstall, not both.");
          }
          if (!options.install && !options.uninstall) {
            process.stdout.write(renderShellFunction(shell, options.name));
            return;
          }
          const action = options.install ? "install" : "uninstall";
          const { changed, path } = await updateShellRcFile(
            shell,
            options.name,
            action,
            process.env,
          );
          const done = action === "install" ? `added to ${path}` : `removed from ${path}`;
          process.stdout.write(
            changed ? `maestro shell-init: ${done}\n` : `maestro shell-init: ${path} unchanged\n`,
          );
        } catch (error) {
          process.stderr.write(
            `maestro shell-init: ${error instanceof Error ? error.message : String(error)}\n`,
          );
          process.exitCode = 1;
        }
      },
    );
}
