import { describe, expect, test } from "vitest";
import { createProgram } from "../../src/cli/main.js";

function getCommandFlags(commandName: string): string[] {
  const command = createProgram().commands.find((entry) => entry.name() === commandName);
  if (!command) {
    throw new Error(`Command "${commandName}" is not registered`);
  }

  return command.options.map((option) => option.flags);
}

describe("CLI program assembly", () => {
  test("registers the expected top-level commands", () => {
    const commandNames = createProgram()
      .commands.map((command) => command.name())
      .sort();

    expect(commandNames).toEqual([
      "bootstrap",
      "code-workspace",
      "doctor",
      "git",
      "init",
      "install",
      "sync",
      "update",
      "upgrade",
      "worktree",
    ]);
  });

  test("keeps workspace and dry-run flags on commands that support them", () => {
    expect(getCommandFlags("install")).toContain("--workspace <path>");
    expect(getCommandFlags("install")).toContain("--dry-run");
    expect(getCommandFlags("bootstrap")).toContain("--workspace <path>");
    expect(getCommandFlags("bootstrap")).toContain("--dry-run");
    expect(getCommandFlags("worktree")).toContain("--workspace <path>");
    expect(getCommandFlags("worktree")).toContain("--dry-run");
    expect(getCommandFlags("doctor")).toContain("--workspace <path>");
  });

  test("keeps init options unchanged", () => {
    expect(getCommandFlags("init")).toContain("--dry-run");
    expect(getCommandFlags("init")).toContain("--runtimes <list>");
    expect(getCommandFlags("init")).not.toContain("--workspace <path>");
  });

  test("keeps workspace flags on git subcommands", () => {
    const git = createProgram().commands.find((entry) => entry.name() === "git");
    if (!git) {
      throw new Error('Command "git" is not registered');
    }

    const getGitSubcommandFlags = (name: string): string[] => {
      const subcommand = git.commands.find((entry) => entry.name() === name);
      if (!subcommand) {
        throw new Error(`Git subcommand "${name}" is not registered`);
      }

      return subcommand.options.map((option) => option.flags);
    };

    expect(getGitSubcommandFlags("checkout")).toContain("--workspace <path>");
    expect(getGitSubcommandFlags("pull")).toContain("--workspace <path>");
    expect(getGitSubcommandFlags("sync")).toContain("--workspace <path>");
  });
});
