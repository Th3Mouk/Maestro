import path from "node:path";
import { Command } from "commander";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { registerEditorWorkspaceCommand } from "../../src/cli/program/commands/register-editor-workspace-command.js";

const { projectEditorWorkspace } = vi.hoisted(() => ({
  projectEditorWorkspace: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("../../src/core/execution-service.js", () => ({ projectEditorWorkspace }));

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerEditorWorkspaceCommand(program);
  return program;
}

describe("registerEditorWorkspaceCommand", () => {
  beforeEach(() => {
    projectEditorWorkspace.mockResolvedValue(undefined);
  });

  test("resolves the workspace path and forwards dryRun", async () => {
    const program = buildProgram();

    await program.parseAsync(["editor-workspace", "--workspace", "./ws", "--dry-run"], {
      from: "user",
    });

    expect(projectEditorWorkspace).toHaveBeenCalledWith(path.resolve(process.cwd(), "./ws"), true);
  });

  test("defaults the workspace to '.' and dryRun to false", async () => {
    const program = buildProgram();

    await program.parseAsync(["editor-workspace"], { from: "user" });

    expect(projectEditorWorkspace).toHaveBeenCalledWith(path.resolve(process.cwd(), "."), false);
  });
});
