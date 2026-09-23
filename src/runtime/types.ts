import type { ResolvedWorkspace } from "../workspace/types.js";

export type RuntimeName =
  | "standard"
  | "claude-code"
  | "codex"
  | "cursor"
  | "copilot"
  | "gemini"
  | "opencode"
  | "kilo"
  | "devin";

export const supportedRuntimeNames = [
  "standard",
  "claude-code",
  "codex",
  "cursor",
  "copilot",
  "gemini",
  "opencode",
  "kilo",
  "devin",
] as const satisfies ReadonlyArray<RuntimeName>;

export type ProjectionAsset = "skills" | "agents" | "workflows";

export interface RuntimeAgentLayout {
  /** Directory, relative to the workspace root, the runtime scans for subagent definitions. */
  dir: string;
  /** File extension written for a Markdown agent (Copilot expects `<name>.agent.md`). */
  markdownExtension: "md" | "agent.md";
}

export interface RuntimeLayout {
  skills?: string;
  agents: RuntimeAgentLayout;
  workflows?: string;
}

/**
 * Native directories each runtime reads. Only `standard` and `claude-code` carry a skills
 * target: every other runtime scans `.agents/skills/` itself. Only Claude Code has a
 * workflow format.
 */
export const runtimeLayouts: Record<RuntimeName, RuntimeLayout> = {
  standard: {
    skills: ".agents/skills",
    agents: { dir: ".agents/agents", markdownExtension: "md" },
  },
  "claude-code": {
    skills: ".claude/skills",
    agents: { dir: ".claude/agents", markdownExtension: "md" },
    workflows: ".claude/workflows",
  },
  codex: { agents: { dir: ".codex/agents", markdownExtension: "md" } },
  cursor: { agents: { dir: ".cursor/agents", markdownExtension: "md" } },
  copilot: { agents: { dir: ".github/agents", markdownExtension: "agent.md" } },
  gemini: { agents: { dir: ".gemini/agents", markdownExtension: "md" } },
  opencode: { agents: { dir: ".opencode/agents", markdownExtension: "md" } },
  kilo: { agents: { dir: ".kilo/agents", markdownExtension: "md" } },
  devin: { agents: { dir: ".devin/agents", markdownExtension: "md" } },
};

export function runtimeSupports(runtime: RuntimeName, asset: ProjectionAsset): boolean {
  return Boolean(runtimeLayouts[runtime][asset]);
}

/**
 * Directories Maestro projects into, for gitignore and the task-worktree overlay. Pass the
 * active projections to list only those; omit it to list every supported target.
 */
export function listRuntimeProjectionDirs(
  active?: Partial<Record<RuntimeName, Partial<Record<ProjectionAsset, unknown>>>>,
): string[] {
  return supportedRuntimeNames.flatMap((runtime) => {
    const layout = runtimeLayouts[runtime];
    const projection = active?.[runtime];
    if (active && !projection) {
      return [];
    }
    const targets: Array<[ProjectionAsset, string | undefined]> = [
      ["skills", layout.skills],
      ["agents", layout.agents.dir],
      ["workflows", layout.workflows],
    ];
    return targets
      .filter(([asset, dir]) => Boolean(dir) && (!projection || Boolean(projection[asset])))
      .map(([, dir]) => dir as string);
  });
}

export interface RuntimeProjectionContext {
  workspaceRoot: string;
  resolvedWorkspace: ResolvedWorkspace;
}

export interface RuntimeProjector {
  name: RuntimeName | string;
  project(context: RuntimeProjectionContext): Promise<void>;
}

export interface RuntimeProjectorRegistry {
  register(projector: RuntimeProjector): void;
  list(): RuntimeProjector[];
}
