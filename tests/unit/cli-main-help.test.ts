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

  test("registers the upgrade command in the CLI surface", () => {
    const commandNames = createProgram()
      .commands.map((command) => command.name())
      .sort();

    expect(commandNames).toContain("upgrade");
  });
});
