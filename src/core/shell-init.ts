import os from "node:os";
import path from "node:path";
import { ensureDir, pathExists, readText, writeText } from "../utils/fs.js";

export const supportedShells = ["zsh", "bash", "fish"] as const;
type ShellName = (typeof supportedShells)[number];

const blockStart = "# >>> maestro shell-init >>>";
const blockEnd = "# <<< maestro shell-init <<<";

/** The shell named on the command line, else the basename of `$SHELL`. */
export function resolveShell(requested: string | undefined, env: NodeJS.ProcessEnv): ShellName {
  const shell = requested ?? path.basename(env.SHELL ?? "");
  if (!(supportedShells as readonly string[]).includes(shell)) {
    throw new Error(
      `Unsupported shell "${shell || "(unset $SHELL)"}"; pass one of ${supportedShells.join(", ")}.`,
    );
  }
  return shell as ShellName;
}

export function assertFunctionName(name: string): void {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`"${name}" is not a valid shell function name.`);
  }
}

/**
 * A thin `cd`-capable wrapper: `<name> <args>` runs `maestro worktree open <args>` (its report
 * on stderr) and changes into the root it prints; `-l` lists tasks; `--prune` prunes. It calls
 * `maestro` from PATH, so the function embeds no machine-specific path.
 */
export function renderShellFunction(shell: ShellName, name: string): string {
  assertFunctionName(name);
  if (shell === "fish") {
    return [
      `function ${name} --description 'Open a Maestro task worktree and cd into it'`,
      '    switch "$argv[1]"',
      "        case -l --list",
      "            set -e argv[1]",
      "            command maestro worktree list --status $argv",
      "            return",
      "        case --prune",
      "            set -e argv[1]",
      "            command maestro worktree prune $argv",
      "            return",
      "    end",
      "    set -l __maestro_root (command maestro worktree open --format human $argv)",
      "    or return",
      '    if test -n "$__maestro_root"; and test -d "$__maestro_root"',
      '        cd "$__maestro_root"',
      "    end",
      "end",
      "",
    ].join("\n");
  }
  return [
    `${name}() {`,
    '  case "${1-}" in',
    '    -l|--list) shift; command maestro worktree list --status "$@"; return ;;',
    '    --prune) shift; command maestro worktree prune "$@"; return ;;',
    "  esac",
    "  local __maestro_root",
    '  __maestro_root="$(command maestro worktree open --format human "$@")" || return',
    '  if [ -n "$__maestro_root" ] && [ -d "$__maestro_root" ]; then',
    '    cd -- "$__maestro_root"',
    "  fi",
    "}",
    "",
  ].join("\n");
}

/** The rc file `--install` edits for a shell. */
function getShellRcPath(shell: ShellName, env: NodeJS.ProcessEnv): string {
  const home = env.HOME ?? os.homedir();
  switch (shell) {
    case "zsh":
      return path.join(env.ZDOTDIR || home, ".zshrc");
    case "bash":
      return path.join(home, ".bashrc");
    case "fish":
      return path.join(home, ".config", "fish", "config.fish");
  }
}

/** The line that loads the function: the same on every machine. */
function renderShellInitLine(shell: ShellName, name: string): string {
  const nameArgument = name === "mw" ? "" : ` --name ${name}`;
  return shell === "fish"
    ? `maestro shell-init fish${nameArgument} | source`
    : `eval "$(maestro shell-init ${shell}${nameArgument})"`;
}

/**
 * Puts the marked block in `content`: replaced in place when present, else appended. The
 * rest of the file is kept byte for byte.
 */
export function installShellInitBlock(content: string, line: string): string {
  const block = `${blockStart}\n${line}\n${blockEnd}\n`;
  const range = findBlock(content);
  if (range) {
    return `${content.slice(0, range.start)}${block}${content.slice(range.end)}`;
  }
  const separator = content === "" || content.endsWith("\n") ? "" : "\n";
  return `${content}${separator}${block}`;
}

/** Removes the marked block, and only it. */
export function uninstallShellInitBlock(content: string): string {
  const range = findBlock(content);
  return range ? `${content.slice(0, range.start)}${content.slice(range.end)}` : content;
}

function findBlock(content: string): { end: number; start: number } | undefined {
  const start = content.indexOf(`${blockStart}\n`);
  if (start === -1 || (start > 0 && content[start - 1] !== "\n")) {
    return undefined;
  }
  const endMarker = content.indexOf(blockEnd, start);
  if (endMarker === -1) {
    return undefined;
  }
  const lineEnd = content.indexOf("\n", endMarker);
  return { start, end: lineEnd === -1 ? content.length : lineEnd + 1 };
}

/**
 * `--install` / `--uninstall`: edits the shell's rc file. Returns the file and whether it
 * changed; a missing rc file is created on install and left alone on uninstall.
 */
export async function updateShellRcFile(
  shell: ShellName,
  name: string,
  action: "install" | "uninstall",
  env: NodeJS.ProcessEnv,
): Promise<{ changed: boolean; path: string }> {
  const rcPath = getShellRcPath(shell, env);
  const original = (await pathExists(rcPath)) ? await readText(rcPath) : undefined;
  if (original === undefined && action === "uninstall") {
    return { changed: false, path: rcPath };
  }
  const updated =
    action === "install"
      ? installShellInitBlock(original ?? "", renderShellInitLine(shell, name))
      : uninstallShellInitBlock(original ?? "");
  if (updated === original) {
    return { changed: false, path: rcPath };
  }
  await ensureDir(path.dirname(rcPath));
  await writeText(rcPath, updated);
  return { changed: true, path: rcPath };
}
