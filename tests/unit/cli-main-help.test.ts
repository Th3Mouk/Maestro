import { describe, expect, test } from "vitest";
import { createProgram } from "../../src/cli/main.js";
import { formatUpgradeInstructions } from "../../src/cli/upgrade.js";
import { getFrameworkVersion } from "../../src/version.js";

describe("CLI help surface", () => {
  test("shows the current framework version and upgrade guidance in root help", () => {
    const help = createProgram().helpInformation();

    expect(help).toContain(`Current version: ${getFrameworkVersion()}`);
    expect(help).toContain(formatUpgradeInstructions());
  });

  test("registers the self upgrade command in the CLI surface", () => {
    const program = createProgram();
    const self = program.commands.find((command) => command.name() === "self");
    expect(self).toBeDefined();
    const selfSubcommands = self?.commands.map((command) => command.name()) ?? [];
    expect(selfSubcommands).toContain("upgrade");
  });
});
