import { execa } from "execa";
import { existsSync } from "node:fs";

const NPM_PACKAGE_NAME = "@th3mouk/maestro";
const HOMEBREW_TAP = "th3mouk/maestro";
const HOMEBREW_FORMULA = `${HOMEBREW_TAP}/maestro`;

export type UpgradeManager = "npm" | "homebrew";

export interface UpgradeCommand {
  command: string;
  args: string[];
}

export function formatUpgradeInstructions(): string {
  return [
    "Upgrade commands:",
    `  npm global: npm install -g ${NPM_PACKAGE_NAME}@latest`,
    `  Homebrew: brew upgrade ${HOMEBREW_FORMULA}`,
    `  If needed first: brew tap ${HOMEBREW_TAP} https://github.com/Th3Mouk/maestro`,
  ].join("\n");
}

export function detectInstalledUpgradeManager(
  argv1: string | undefined = process.argv[1],
): UpgradeManager | null {
  const normalized = (argv1 ?? "").toLowerCase();

  if (normalized.length === 0) {
    return null;
  }

  if (
    (normalized.includes("/cellar/") && normalized.includes("/maestro/")) ||
    normalized.endsWith("/opt/homebrew/bin/maestro") ||
    normalized.endsWith("/usr/local/bin/maestro")
  ) {
    return "homebrew";
  }

  if (normalized.includes("/node_modules/@th3mouk/maestro/")) {
    return "npm";
  }

  return null;
}

export function hasHomebrewMaestroBinary(
  pathExists: (path: string) => boolean = existsSync,
): boolean {
  return ["/opt/homebrew/bin/maestro", "/usr/local/bin/maestro"].some((binaryPath) =>
    pathExists(binaryPath),
  );
}

export function resolveUpgradeManager(
  argv1: string | undefined = process.argv[1],
  pathExists: (path: string) => boolean = existsSync,
): UpgradeManager {
  const detected = detectInstalledUpgradeManager(argv1);
  if (detected) {
    return detected;
  }

  if (hasHomebrewMaestroBinary(pathExists)) {
    return "homebrew";
  }

  return "npm";
}

export function buildUpgradeCommands(manager: UpgradeManager): UpgradeCommand[] {
  if (manager === "homebrew") {
    return [
      {
        command: "brew",
        args: ["tap", HOMEBREW_TAP, "https://github.com/Th3Mouk/maestro"],
      },
      {
        command: "brew",
        args: ["upgrade", HOMEBREW_FORMULA],
      },
    ];
  }

  return [
    {
      command: "npm",
      args: ["install", "-g", `${NPM_PACKAGE_NAME}@latest`],
    },
  ];
}

export async function executeUpgradeCommands(commands: UpgradeCommand[]): Promise<void> {
  for (const step of commands) {
    await execa(step.command, step.args, { stdio: "inherit", preferLocal: false });
  }
}

export async function runUpgrade(argv1: string | undefined = process.argv[1]): Promise<void> {
  const manager = resolveUpgradeManager(argv1);
  await executeUpgradeCommands(buildUpgradeCommands(manager));
}
