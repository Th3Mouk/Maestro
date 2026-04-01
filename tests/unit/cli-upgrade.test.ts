import { describe, expect, test } from "vitest";
import {
  buildUpgradeCommands,
  detectInstalledUpgradeManager,
  formatUpgradeInstructions,
  hasHomebrewMaestroBinary,
  resolveUpgradeManager,
} from "../../src/cli/upgrade.js";

describe("upgrade helpers", () => {
  test("renders upgrade instructions", () => {
    expect(formatUpgradeInstructions()).toContain("npm install -g @th3mouk/maestro@latest");
    expect(formatUpgradeInstructions()).toContain("brew upgrade th3mouk/maestro/maestro");
  });

  test("detects npm installs from node_modules path", () => {
    const manager = detectInstalledUpgradeManager(
      "/Users/alex/.nvm/versions/node/v22.12.0/lib/node_modules/@th3mouk/maestro/bin/maestro.js",
    );

    expect(manager).toBe("npm");
  });

  test("detects homebrew installs from Cellar path", () => {
    const manager = detectInstalledUpgradeManager(
      "/opt/homebrew/Cellar/maestro/0.1.3/libexec/lib/node_modules/@th3mouk/maestro/bin/maestro.js",
    );

    expect(manager).toBe("homebrew");
  });

  test("detects known homebrew binary paths", () => {
    expect(detectInstalledUpgradeManager("/opt/homebrew/bin/maestro")).toBe("homebrew");
    expect(detectInstalledUpgradeManager("/usr/local/bin/maestro")).toBe("homebrew");
  });

  test("defaults to npm when manager cannot be detected", () => {
    expect(resolveUpgradeManager("/tmp/custom/maestro.js", () => false)).toBe("npm");
  });

  test("uses homebrew fallback when homebrew maestro binary exists", () => {
    expect(resolveUpgradeManager("/tmp/custom/maestro.js", () => true)).toBe("homebrew");
  });

  test("checks known homebrew binary locations", () => {
    expect(hasHomebrewMaestroBinary(() => true)).toBe(true);
    expect(hasHomebrewMaestroBinary(() => false)).toBe(false);
  });

  test("builds npm upgrade command", () => {
    expect(buildUpgradeCommands("npm")).toEqual([
      {
        command: "npm",
        args: ["install", "-g", "@th3mouk/maestro@latest"],
      },
    ]);
  });

  test("builds Homebrew tap + upgrade commands", () => {
    expect(buildUpgradeCommands("homebrew")).toEqual([
      {
        command: "brew",
        args: ["tap", "th3mouk/maestro", "https://github.com/Th3Mouk/maestro"],
      },
      {
        command: "brew",
        args: ["upgrade", "th3mouk/maestro/maestro"],
      },
    ]);
  });
});
