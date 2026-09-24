import type { RuntimeName } from "../../runtime/types.js";
import type { ResolvedAgent } from "../types.js";

const runtimeLabels: Record<RuntimeName, string> = {
  standard: "the shared .agents/ convention",
  "claude-code": "Claude Code",
  codex: "Codex",
  cursor: "Cursor",
  copilot: "GitHub Copilot",
  gemini: "Gemini CLI",
  opencode: "OpenCode",
  kilo: "Kilo Code",
  devin: "Devin",
};

/** Placeholder for a selected agent name that no workspace, override, or pack file defines. */
export function createDefaultAgent(name: string, runtime: RuntimeName): ResolvedAgent {
  const description = `Generated agent for ${runtimeLabels[runtime]}.`;

  if (runtime === "codex") {
    return {
      name,
      runtime,
      source: "default",
      content: [
        `name = ${JSON.stringify(name)}`,
        `description = ${JSON.stringify(description)}`,
        `developer_instructions = ${JSON.stringify(description)}`,
        "",
      ].join("\n"),
      extension: "toml",
    };
  }

  return {
    name,
    runtime,
    source: "default",
    content: [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      "---",
      "",
      `# ${name}`,
      "",
    ].join("\n"),
    extension: "md",
  };
}
