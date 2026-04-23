import { describe, expect, test } from "vitest";
import type { Command } from "commander";
import { createProgram } from "../../src/cli/main.js";

function findCommand(parent: Command, name: string): Command {
  const found = parent.commands.find((entry) => entry.name() === name);
  if (!found) {
    throw new Error(`Command "${name}" is not registered under "${parent.name()}"`);
  }
  return found;
}

function getFlags(command: Command): string[] {
  return command.options.map((option) => option.flags);
}

describe("CLI program assembly", () => {
  test("registers the expected top-level command groups", () => {
    const commandNames = createProgram()
      .commands.map((command) => command.name())
      .sort();

    expect(commandNames).toEqual([
      "editor-workspace",
      "init",
      "repo",
      "self",
      "workspace",
      "worktree",
    ]);
  });

  test("workspace group exposes install, update, prune, doctor", () => {
    const workspace = findCommand(createProgram(), "workspace");
    const names = workspace.commands.map((entry) => entry.name()).sort();
    expect(names).toEqual(["doctor", "install", "prune", "update"]);

    for (const name of ["install", "update", "prune"]) {
      expect(getFlags(findCommand(workspace, name))).toEqual(
        expect.arrayContaining(["--workspace <path>", "--dry-run"]),
      );
    }
    expect(getFlags(findCommand(workspace, "doctor"))).toContain("--workspace <path>");
  });

  test("repo group exposes bootstrap, list, and git subgroup", () => {
    const repo = findCommand(createProgram(), "repo");
    const names = repo.commands.map((entry) => entry.name()).sort();
    expect(names).toEqual(["bootstrap", "git", "list"]);

    expect(getFlags(findCommand(repo, "bootstrap"))).toEqual(
      expect.arrayContaining(["--workspace <path>", "--dry-run", "--repository <name>"]),
    );
    expect(getFlags(findCommand(repo, "list"))).toContain("--workspace <path>");

    const git = findCommand(repo, "git");
    expect(git.commands.map((entry) => entry.name()).sort()).toEqual(["checkout", "pull", "sync"]);
    for (const name of ["checkout", "pull", "sync"]) {
      expect(getFlags(findCommand(git, name))).toContain("--workspace <path>");
    }
  });

  test("worktree group exposes create, remove, list", () => {
    const worktree = findCommand(createProgram(), "worktree");
    const names = worktree.commands.map((entry) => entry.name()).sort();
    expect(names).toEqual(["create", "list", "remove"]);

    expect(getFlags(findCommand(worktree, "create"))).toEqual(
      expect.arrayContaining(["--workspace <path>", "--dry-run", "--task <name>"]),
    );
    expect(getFlags(findCommand(worktree, "remove"))).toEqual(
      expect.arrayContaining(["--workspace <path>", "--dry-run", "--task <name>", "--force"]),
    );
    expect(getFlags(findCommand(worktree, "list"))).toContain("--workspace <path>");
  });

  test("self group exposes upgrade", () => {
    const self = findCommand(createProgram(), "self");
    expect(self.commands.map((entry) => entry.name())).toEqual(["upgrade"]);
  });

  test("init keeps its positional and options", () => {
    const init = findCommand(createProgram(), "init");
    expect(getFlags(init)).toEqual(expect.arrayContaining(["--dry-run", "--runtimes <list>"]));
    expect(getFlags(init)).not.toContain("--workspace <path>");
  });

  test("editor-workspace command is registered at top level", () => {
    const editor = findCommand(createProgram(), "editor-workspace");
    expect(getFlags(editor)).toEqual(expect.arrayContaining(["--workspace <path>", "--dry-run"]));
  });
});
