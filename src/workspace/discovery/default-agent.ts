import type { RuntimeName } from "../../runtime/types.js";
import type { ResolvedAgent } from "../types.js";

export function createDefaultAgent(name: string, runtime: RuntimeName): ResolvedAgent {
  const contentByRuntime: Record<RuntimeName, string> = {
    codex: [
      "# Generated agent",
      `name = "${name}"`,
      `prompt = "Act as ${name} for workspace maintenance."`,
    ].join("\n"),
    "claude-code": `# ${name}\n\nGenerated agent for Claude Code.\n`,
    opencode: `# ${name}\n\nGenerated agent for OpenCode.\n`,
  };

  return {
    name,
    runtime,
    source: "default",
    content: contentByRuntime[runtime],
    extension: runtime === "codex" ? "toml" : "md",
  };
}
