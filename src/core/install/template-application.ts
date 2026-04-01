import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import { pathExists, resolveSafePath, writeText } from "../../utils/fs.js";

const TEMPLATE_TARGETS = ["AGENTS.md", "CLAUDE.md"] as const;

export async function applyWorkspaceTemplates(
  workspaceRoot: string,
  resolvedWorkspace: ResolvedWorkspace,
  dryRun: boolean,
): Promise<void> {
  for (const templateName of TEMPLATE_TARGETS) {
    const overridePath = resolveSafePath(
      workspaceRoot,
      path.join("overrides", "templates", templateName),
      "template override path",
    );
    if (await pathExists(overridePath)) {
      if (!dryRun) {
        await writeText(
          resolveSafePath(workspaceRoot, templateName, "template target path"),
          await readFile(overridePath, "utf8"),
        );
      }
      continue;
    }

    const packPath = resolvedWorkspace.packs
      .map((pack) => path.join(pack.root, "templates", templateName))
      .find((candidate) => existsSync(candidate));

    if (packPath && !dryRun) {
      await writeText(
        resolveSafePath(workspaceRoot, templateName, "template target path"),
        await readFile(packPath, "utf8"),
      );
    }
  }
}
