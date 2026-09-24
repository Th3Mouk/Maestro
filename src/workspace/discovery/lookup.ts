import path from "node:path";
import {
  listDirectories,
  listFiles,
  mapWithConcurrency,
  pathExists,
  resolveSafePath,
} from "../../utils/fs.js";

// Longest first so `planner.agent.md` resolves to `planner`, not `planner.agent`.
const AGENT_EXTENSIONS = ["agent.md", "toml", "md", "json"] as const;
const WORKFLOW_EXTENSION = "js";
const LOOKUP_CONCURRENCY_LIMIT = 4;

export async function findAgentFile(root: string, name: string): Promise<string | undefined> {
  resolveSafePath(root, name, "agent name");
  for (const extension of AGENT_EXTENSIONS) {
    const candidatePath = resolveSafePath(root, `${name}.${extension}`, "agent file");
    if (await pathExists(candidatePath)) {
      return candidatePath;
    }
  }

  return undefined;
}

export async function findWorkflowFile(root: string, name: string): Promise<string | undefined> {
  const workflowPath = resolveSafePath(root, `${name}.${WORKFLOW_EXTENSION}`, "workflow file");
  return (await pathExists(workflowPath)) ? workflowPath : undefined;
}

/** Names of every `<name>.js` workflow script directly under `root` (e.g. `workflows/`). */
export async function listWorkflowNames(root: string): Promise<string[]> {
  return (await listFiles(root))
    .filter((file) => file.endsWith(`.${WORKFLOW_EXTENSION}`))
    .map((file) => file.slice(0, -(WORKFLOW_EXTENSION.length + 1)))
    .sort((left, right) => left.localeCompare(right));
}

export async function findSkillRoot(root: string, name: string): Promise<string | undefined> {
  const skillRoot = resolveSafePath(root, name, "skill name");
  return (await pathExists(path.join(skillRoot, "SKILL.md"))) ? skillRoot : undefined;
}

/** Names of every agent file directly under `root` (e.g. `agents/<runtime>/`), for the "no explicit selection means all of them" default. */
export async function listAgentNames(root: string): Promise<string[]> {
  const names = new Set<string>();
  for (const file of await listFiles(root)) {
    const extension = AGENT_EXTENSIONS.find((candidate) => file.endsWith(`.${candidate}`));
    if (extension) {
      names.add(file.slice(0, -(extension.length + 1)));
    }
  }

  return [...names].sort((left, right) => left.localeCompare(right));
}

/** Names of every skill directory directly under `root` (e.g. `skills/`), for the "no explicit selection means all of them" default. */
export async function listSkillNames(root: string): Promise<string[]> {
  const directories = await listDirectories(root);
  const isSkillDirectory = await mapWithConcurrency(
    directories,
    LOOKUP_CONCURRENCY_LIMIT,
    (directory) => pathExists(path.join(root, directory, "SKILL.md")),
  );

  return directories
    .filter((_directory, index) => isSkillDirectory[index])
    .sort((left, right) => left.localeCompare(right));
}

export async function findPolicyFile(root: string, name: string): Promise<string | undefined> {
  const policyPath = resolveSafePath(root, `${name}.yaml`, "policy file");
  return (await pathExists(policyPath)) ? policyPath : undefined;
}
