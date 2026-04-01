import path from "node:path";
import { pathExists, resolveSafePath } from "../../utils/fs.js";

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

export async function findPolicyFile(root: string, name: string): Promise<string | undefined> {
  const policyPath = resolveSafePath(root, `${name}.yaml`, "policy file");
  return (await pathExists(policyPath)) ? policyPath : undefined;
}
