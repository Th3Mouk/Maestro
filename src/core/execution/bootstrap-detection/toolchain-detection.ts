export function detectToolchains(commands: string[]): string[] {
  const tools = new Set<string>();
  for (const command of commands) {
    if (command.includes("composer ")) {
      tools.add("php");
      tools.add("composer");
    }
    if (command.includes("uv ")) {
      tools.add("python");
      tools.add("uv");
    }
    if (command.includes("python3 ") || command.includes("pip install")) {
      tools.add("python");
    }
    if (
      command.includes("pnpm ") ||
      command.includes("yarn ") ||
      command.includes("npm ") ||
      command.includes("bun ")
    ) {
      tools.add("node");
    }
  }
  return [...tools].sort((left, right) => left.localeCompare(right));
}
