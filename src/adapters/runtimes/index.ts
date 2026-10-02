import { lstat, readFile, rm, symlink } from "node:fs/promises";
import path from "node:path";
import {
  runtimeLayouts,
  supportedRuntimeNames,
  type RuntimeLayout,
  type RuntimeName,
  type RuntimeProjectionContext,
  type RuntimeProjector,
} from "../../runtime/types.js";
import type {
  ResolvedAgent,
  ResolvedRuntimeProjection,
  ResolvedSkill,
  ResolvedWorkflow,
  ResolvedWorkspace,
  RuntimeProjectionMode,
} from "../../workspace/types.js";
import {
  copyDir,
  ensureDir,
  pathExists,
  removeIfExists,
  writeJson,
  writeText,
} from "../../utils/fs.js";

// "replace" wipes the whole target directory first so Maestro owns it outright.
// "merge" (the default) only touches entries whose name Maestro is about to project,
// so hand-placed agents/skills/workflows that share the directory survive untouched.
async function prepareTargetDir(
  targetDir: string,
  mode: RuntimeProjectionMode,
  { createIfEmpty, hasEntries }: { createIfEmpty: boolean; hasEntries: boolean },
): Promise<boolean> {
  if (mode === "replace") {
    await removeIfExists(targetDir);
  }
  if (!hasEntries && !createIfEmpty) {
    return false;
  }
  await ensureDir(targetDir);
  return true;
}

async function projectSkills(
  skillsDir: string,
  skills: ResolvedSkill[],
  mode: RuntimeProjectionMode,
  linkRoot: string | undefined,
): Promise<void> {
  // A hand-made `.claude/skills -> .agents/skills` link would make every per-skill removal
  // below delete the real source; replace the link itself with a directory.
  if (await isSymbolicLink(skillsDir)) {
    await rm(skillsDir, { force: true });
  }
  await prepareTargetDir(skillsDir, mode, { createIfEmpty: true, hasEntries: skills.length > 0 });

  for (const skill of skills) {
    const targetSkillDir = path.join(skillsDir, skill.name);
    if (mode === "merge") {
      await removeIfExists(targetSkillDir);
    }
    if (linkRoot) {
      await ensureDir(path.dirname(targetSkillDir));
      await symlink(
        path.relative(path.dirname(targetSkillDir), path.join(linkRoot, skill.name)),
        targetSkillDir,
        "dir",
      );
      continue;
    }
    await copyDir(skill.root, targetSkillDir);
  }
}

async function isSymbolicLink(target: string): Promise<boolean> {
  try {
    return (await lstat(target)).isSymbolicLink();
  } catch {
    return false;
  }
}

function agentFileName(agent: ResolvedAgent, layout: RuntimeLayout): string {
  const extension =
    agent.extension === "md" || agent.extension === "agent.md"
      ? layout.agents.markdownExtension
      : agent.extension;
  return `${agent.name}.${extension}`;
}

async function projectAgents(
  agentsDir: string,
  agents: ResolvedAgent[],
  mode: RuntimeProjectionMode,
  layout: RuntimeLayout,
): Promise<void> {
  const prepared = await prepareTargetDir(agentsDir, mode, {
    createIfEmpty: false,
    hasEntries: agents.length > 0,
  });
  if (!prepared) {
    return;
  }

  for (const agent of agents) {
    await writeText(path.join(agentsDir, agentFileName(agent, layout)), agent.content);
  }
}

async function projectWorkflows(
  workflowsDir: string,
  workflows: ResolvedWorkflow[],
  mode: RuntimeProjectionMode,
): Promise<void> {
  const prepared = await prepareTargetDir(workflowsDir, mode, {
    createIfEmpty: false,
    hasEntries: workflows.length > 0,
  });
  if (!prepared) {
    return;
  }

  // Always real files: Claude Code refuses to save through a symlinked workflow path.
  for (const workflow of workflows) {
    await writeText(
      path.join(workflowsDir, `${workflow.name}.js`),
      await readFile(workflow.filePath, "utf8"),
    );
  }
}

/**
 * `.claude/skills/<name>` links to `.agents/skills/<name>` only when the standard runtime
 * projects skills too, so the link target exists. Windows falls back to a copy because
 * directory symlinks there need Developer Mode or elevated rights.
 */
function resolveSkillLinkRoot(
  runtime: RuntimeName,
  projection: ResolvedRuntimeProjection,
  resolvedWorkspace: ResolvedWorkspace,
  workspaceRoot: string,
): string | undefined {
  const standardSkillsDir = runtimeLayouts.standard.skills;
  if (
    runtime === "standard" ||
    projection.skills?.strategy !== "symlink" ||
    !resolvedWorkspace.runtimes.standard?.skills ||
    !standardSkillsDir ||
    process.platform === "win32"
  ) {
    return undefined;
  }

  return path.join(workspaceRoot, standardSkillsDir);
}

class LayoutRuntimeProjector implements RuntimeProjector {
  constructor(readonly name: RuntimeName) {}

  async project({ workspaceRoot, resolvedWorkspace }: RuntimeProjectionContext): Promise<void> {
    const projection = resolvedWorkspace.runtimes[this.name];
    if (!projection) {
      return;
    }
    const layout = runtimeLayouts[this.name];

    if (projection.skills && layout.skills) {
      await projectSkills(
        path.join(workspaceRoot, layout.skills),
        resolvedWorkspace.selectedSkills,
        projection.skills.mode,
        resolveSkillLinkRoot(this.name, projection, resolvedWorkspace, workspaceRoot),
      );
    }

    if (projection.agents) {
      await projectAgents(
        path.join(workspaceRoot, layout.agents.dir),
        resolvedWorkspace.selectedAgents[this.name],
        projection.agents.mode,
        layout,
      );
    }

    if (projection.workflows && layout.workflows) {
      await projectWorkflows(
        path.join(workspaceRoot, layout.workflows),
        resolvedWorkspace.selectedWorkflows,
        projection.workflows.mode,
      );
    }

    if (this.name === "claude-code") {
      await projectClaudeSettings(workspaceRoot, resolvedWorkspace, projection);
    }
  }
}

/** The `.claude/settings.json` hook entries Maestro owns when `worktreeHooks` is on. */
export const claudeWorktreeHookCommands = {
  WorktreeCreate: "maestro worktree hook claude-create",
  WorktreeRemove: "maestro worktree hook claude-remove",
} as const;

// `postCreate` hooks may seed large dependency trees.
const claudeWorktreeHookTimeoutSeconds = 600;

/**
 * Merges plugin keys and the worktree hooks into `.claude/settings.json` without owning the
 * file: permissions, other hooks, MCP, and everything else a team versions there stay
 * untouched. Turning `worktreeHooks` off removes exactly the Maestro hook entries.
 */
async function projectClaudeSettings(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  projection: ResolvedRuntimeProjection,
): Promise<void> {
  const claudePlugins = resolvedWorkspace.plugins["claude-code"];
  const managesPlugins = Boolean(claudePlugins?.enabled || claudePlugins?.marketplaces);
  const settingsPath = path.join(workspaceRoot, ".claude", "settings.json");
  const settingsExist = await pathExists(settingsPath);
  if (!managesPlugins && !projection.worktreeHooks && !settingsExist) {
    return;
  }

  const original = settingsExist ? await readFile(settingsPath, "utf8") : undefined;
  const settings = original === undefined ? {} : parseSettings(original, settingsPath);

  if (managesPlugins) {
    // Markers written by Maestro <= 0.5 into a file it used to own outright.
    if (settings.generated === true) {
      delete settings.generated;
      delete settings.workspace;
    }
    if (claudePlugins?.enabled) {
      settings.enabledPlugins = claudePlugins.enabled;
    }
    if (claudePlugins?.marketplaces) {
      settings.extraKnownMarketplaces = claudePlugins.marketplaces;
    }
  }

  const hooksChanged = projection.worktreeHooks
    ? addClaudeWorktreeHooks(settings)
    : removeClaudeWorktreeHooks(settings);

  if (managesPlugins || hooksChanged || original === undefined) {
    await writeJson(settingsPath, settings);
  }
}

type ClaudeHookGroup = { hooks?: Array<Record<string, unknown>>; [key: string]: unknown };

function readHookGroups(settings: Record<string, unknown>, event: string): ClaudeHookGroup[] {
  const hooks = settings.hooks;
  if (!hooks || typeof hooks !== "object" || Array.isArray(hooks)) {
    return [];
  }
  const groups = (hooks as Record<string, unknown>)[event];
  return Array.isArray(groups) ? (groups as ClaudeHookGroup[]) : [];
}

function isMaestroHook(hook: Record<string, unknown>, command: string): boolean {
  return hook.type === "command" && hook.command === command;
}

/** Adds each missing Maestro hook entry. Returns whether the settings changed. */
function addClaudeWorktreeHooks(settings: Record<string, unknown>): boolean {
  let changed = false;
  for (const [event, command] of Object.entries(claudeWorktreeHookCommands)) {
    const groups = readHookGroups(settings, event);
    if (groups.some((group) => group.hooks?.some((hook) => isMaestroHook(hook, command)))) {
      continue;
    }
    const hooks =
      settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks)
        ? (settings.hooks as Record<string, unknown>)
        : {};
    hooks[event] = [
      ...groups,
      {
        hooks: [{ type: "command", command, timeout: claudeWorktreeHookTimeoutSeconds }],
      },
    ];
    settings.hooks = hooks;
    changed = true;
  }
  return changed;
}

/** Removes the Maestro hook entries, and the groups and keys they leave empty. */
function removeClaudeWorktreeHooks(settings: Record<string, unknown>): boolean {
  let changed = false;
  for (const [event, command] of Object.entries(claudeWorktreeHookCommands)) {
    const groups = readHookGroups(settings, event);
    if (!groups.some((group) => group.hooks?.some((hook) => isMaestroHook(hook, command)))) {
      continue;
    }
    const kept = groups.flatMap((group) => {
      const hooks = group.hooks?.filter((hook) => !isMaestroHook(hook, command));
      return hooks && hooks.length === 0 ? [] : [{ ...group, hooks }];
    });
    const allHooks = settings.hooks as Record<string, unknown>;
    if (kept.length > 0) {
      allHooks[event] = kept;
    } else {
      delete allHooks[event];
    }
    if (Object.keys(allHooks).length === 0) {
      delete settings.hooks;
    }
    changed = true;
  }
  return changed;
}

function parseSettings(content: string, settingsPath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(content);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Fall through to the shared error below.
  }
  throw new Error(`Cannot merge Claude Code settings: ${settingsPath} is not a JSON object.`);
}

export function createBuiltInProjectors(): RuntimeProjector[] {
  return supportedRuntimeNames.map((runtime) => new LayoutRuntimeProjector(runtime));
}
