import { Command } from "commander";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { registerSelfCommand } from "../../src/cli/program/commands/register-self-command.js";

const { runUpgrade } = vi.hoisted(() => ({
  runUpgrade: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("../../src/cli/upgrade.js", () => ({ runUpgrade }));

function buildProgram(): Command {
  const program = new Command();
  program.exitOverride();
  registerSelfCommand(program);
  return program;
}

describe("registerSelfCommand", () => {
  beforeEach(() => {
    runUpgrade.mockResolvedValue(undefined);
  });

  test("self upgrade invokes runUpgrade", async () => {
    const program = buildProgram();

    await program.parseAsync(["self", "upgrade"], { from: "user" });

    expect(runUpgrade).toHaveBeenCalledTimes(1);
  });
});
