import path from "node:path";
import { Command } from "commander";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { registerInitCommand } from "../../src/cli/program/commands/register-init-command.js";

const { initWorkspace } = vi.hoisted(() => ({
  initWorkspace: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
}));

vi.mock("../../src/core/commands/workspace-init.js", () => ({ initWorkspace }));

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerInitCommand(program);
  return program;
}

describe("registerInitCommand", () => {
  beforeEach(() => {
    initWorkspace.mockResolvedValue(undefined);
  });

  test("resolves the target directory and parses --runtimes into a deduplicated list", async () => {
    const program = buildProgram();

    await program.parseAsync(["init", "my-workspace", "--runtimes", "claude-code,standard"], {
      from: "user",
    });

    expect(initWorkspace).toHaveBeenCalledWith(path.resolve(process.cwd(), "my-workspace"), {
      dryRun: false,
      runtimeNames: ["claude-code", "standard"],
    });
  });

  test("defaults the directory to '.' and forwards the default --runtimes value", async () => {
    const program = buildProgram();

    await program.parseAsync(["init"], { from: "user" });

    expect(initWorkspace).toHaveBeenCalledWith(path.resolve(process.cwd(), "."), {
      dryRun: false,
      runtimeNames: ["standard", "claude-code"],
    });
  });

  test("forwards --dry-run", async () => {
    const program = buildProgram();

    await program.parseAsync(["init", "my-workspace", "--dry-run"], { from: "user" });

    const [, options] = initWorkspace.mock.calls[0] ?? [];
    expect(options).toMatchObject({ dryRun: true });
  });

  test("rejects an unsupported runtime name before calling initWorkspace", async () => {
    const program = buildProgram();

    await expect(
      program.parseAsync(["init", "my-workspace", "--runtimes", "bogus"], { from: "user" }),
    ).rejects.toThrow(/Unsupported runtime\(s\): bogus/);
    expect(initWorkspace).not.toHaveBeenCalled();
  });
});
