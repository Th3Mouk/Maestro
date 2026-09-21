import path from "node:path";
import { Command } from "commander";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { registerWorkspaceCommand } from "../../src/cli/program/commands/register-workspace-command.js";
import { createCommandContextFixture } from "../utils/test-doubles.js";
import type { CommandContext } from "../../src/cli/program/commands/command-types.js";
import type { HumanReportKind } from "../../src/cli/output/human-renderer.js";
import type { OutputOptionValues } from "../../src/cli/program/shared-options.js";

const { installWorkspace, updateWorkspace, syncWorkspace, doctorWorkspace, runReportAction } =
  vi.hoisted(() => ({
    installWorkspace: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    updateWorkspace: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    syncWorkspace: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    doctorWorkspace: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
    runReportAction: vi.fn<
      (
        options: OutputOptionValues,
        reportKind: HumanReportKind,
        run: () => Promise<unknown>,
      ) => Promise<void>
    >(async (_options, _reportKind, run) => {
      await run();
    }),
  }));

vi.mock("../../src/core/commands/workspace-install.js", () => ({
  installWorkspace,
  updateWorkspace,
  syncWorkspace,
}));

vi.mock("../../src/core/commands/workspace-doctor.js", () => ({ doctorWorkspace }));

vi.mock("../../src/cli/program/commands/command-helpers.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/cli/program/commands/command-helpers.js")>();
  return { ...actual, runReportAction };
});

function buildProgram(commandContext: CommandContext): Command {
  const program = new Command();
  program.exitOverride();
  registerWorkspaceCommand(program, commandContext);
  return program;
}

describe("registerWorkspaceCommand", () => {
  beforeEach(() => {
    installWorkspace.mockResolvedValue({ status: "ok" });
    updateWorkspace.mockResolvedValue({ status: "ok" });
    syncWorkspace.mockResolvedValue({ status: "ok" });
    doctorWorkspace.mockResolvedValue({ status: "ok" });
  });

  test("install resolves the workspace path, forwards dryRun, and reports as install", async () => {
    const commandContext = createCommandContextFixture();
    const program = buildProgram(commandContext);

    await program.parseAsync(["workspace", "install", "--workspace", "./ws", "--dry-run"], {
      from: "user",
    });

    expect(installWorkspace).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "./ws"),
      { dryRun: true },
      commandContext,
    );
    expect(runReportAction.mock.calls[0]?.[1]).toBe("install");
  });

  test("install defaults to the current directory and dryRun false without flags", async () => {
    const commandContext = createCommandContextFixture();
    const program = buildProgram(commandContext);

    await program.parseAsync(["workspace", "install"], { from: "user" });

    expect(installWorkspace).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "."),
      { dryRun: false },
      commandContext,
    );
  });

  test("update resolves the workspace path, forwards dryRun, and reports as install", async () => {
    const commandContext = createCommandContextFixture();
    const program = buildProgram(commandContext);

    await program.parseAsync(["workspace", "update", "--workspace", "./ws", "--dry-run"], {
      from: "user",
    });

    expect(updateWorkspace).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "./ws"),
      { dryRun: true },
      commandContext,
    );
    expect(runReportAction.mock.calls[0]?.[1]).toBe("install");
  });

  test("prune resolves the workspace path, forwards dryRun, and reports as install", async () => {
    const commandContext = createCommandContextFixture();
    const program = buildProgram(commandContext);

    await program.parseAsync(["workspace", "prune", "--workspace", "./ws"], { from: "user" });

    expect(syncWorkspace).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "./ws"),
      { dryRun: false },
      commandContext,
    );
    expect(runReportAction.mock.calls[0]?.[1]).toBe("install");
  });

  test("doctor resolves the workspace path and reports as doctor", async () => {
    const commandContext = createCommandContextFixture();
    const program = buildProgram(commandContext);

    await program.parseAsync(["workspace", "doctor", "--workspace", "./ws"], { from: "user" });

    expect(doctorWorkspace).toHaveBeenCalledWith(
      path.resolve(process.cwd(), "./ws"),
      commandContext,
    );
    expect(runReportAction.mock.calls[0]?.[1]).toBe("doctor");
  });
});
