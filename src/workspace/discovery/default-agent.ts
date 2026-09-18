import type { RuntimeName } from "../../runtime/types.js";
import type { ResolvedAgent } from "../types.js";

export function createDefaultAgent(name: string, runtime: RuntimeName): ResolvedAgent {
  const contentByRuntime: Record<RuntimeName, string> = {
    "claude-code": `# ${name}\n\nGenerated agent for Claude Code.\n`,
    standard: `# ${name}\n\nGenerated agent for the shared .agents/ standard.\n`,
  };

  return {
    name,
    runtime,
    source: "default",
    content: contentByRuntime[runtime],
    extension: "md",
  };
}
