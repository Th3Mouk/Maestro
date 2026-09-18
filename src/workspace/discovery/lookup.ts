import path from "node:path";
import { listDirectories, listFiles, pathExists, resolveSafePath } from "../../utils/fs.js";

const AGENT_EXTENSIONS = ["toml", "md", "json"] as const;

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

export async function findSkillRoot(root: string, name: string): Promise<string | undefined> {
  const skillRoot = resolveSafePath(root, name, "skill name");
  return (await pathExists(path.join(skillRoot, "SKILL.md"))) ? skillRoot : undefined;
}

/** Names of every agent file directly under `root` (e.g. `agents/<runtime>/`), for the "no explicit selection means all of them" default. */
export async function listAgentNames(root: string): Promise<string[]> {
  const names = new Set<string>();
  for (const file of await listFiles(root)) {
    const extension = path.extname(file).slice(1);
    if ((AGENT_EXTENSIONS as readonly string[]).includes(extension)) {
      names.add(file.slice(0, -(extension.length + 1)));
    }
  }

  return [...names].sort((left, right) => left.localeCompare(right));
}

/** Names of every skill directory directly under `root` (e.g. `skills/`), for the "no explicit selection means all of them" default. */
export async function listSkillNames(root: string): Promise<string[]> {
  const names: string[] = [];
  for (const directory of await listDirectories(root)) {
    if (await pathExists(path.join(root, directory, "SKILL.md"))) {
      names.push(directory);
    }
  }

  return names.sort((left, right) => left.localeCompare(right));
}

export async function findPolicyFile(root: string, name: string): Promise<string | undefined> {
  const policyPath = resolveSafePath(root, `${name}.yaml`, "policy file");
  return (await pathExists(policyPath)) ? policyPath : undefined;
}
