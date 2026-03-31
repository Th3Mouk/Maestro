import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { ResolvedWorkspace } from "../../workspace/types.js";
import { ensureDir, resolveSafePath } from "../../utils/fs.js";
import { errorMessage, MaestroError } from "../errors.js";

export async function runPackHooks(
  resolvedWorkspace: ResolvedWorkspace,
  hookName: "install" | "validate",
  dryRun = false,
  collectIssues = false,
): Promise<Array<{ code: string; message: string }>> {
  if (dryRun) {
    return [];
  }

  const issues: Array<{ code: string; message: string }> = [];
  for (const pack of resolvedWorkspace.packs) {
    for (const relativeScript of pack.manifest.spec.provides?.hooks?.[hookName] ?? []) {
      try {
        const absolutePath = resolveSafePath(pack.root, relativeScript, "pack hook path");
        if (!existsSync(absolutePath)) {
          continue;
        }

        await ensureDir(
          resolveSafePath(resolvedWorkspace.workspaceRoot, ".maestro/reports", "workspace reports"),
        );

        const moduleRecord = (await import(pathToFileURL(absolutePath).href)) as Record<
          string,
          unknown
        >;
        const hook = moduleRecord[hookName];
        if (typeof hook !== "function") {
          continue;
        }

        const result = await (hook as (context: unknown) => Promise<unknown> | unknown)({
          workspaceRoot: resolvedWorkspace.workspaceRoot,
          maestroRoot: resolvedWorkspace.workspaceRoot,
          packRoot: pack.root,
          manifest: resolvedWorkspace.manifest,
        });

        if (
          collectIssues &&
          result &&
          typeof result === "object" &&
          "ok" in result &&
          (result as { ok: boolean }).ok === false
        ) {
          issues.push({
            code: `PACK_${hookName.toUpperCase()}_FAILED`,
            message: `${pack.manifest.metadata.name}: ${String((result as { message?: string }).message ?? "hook failed")}`,
          });
        }
      } catch (error) {
        const maestroError = new MaestroError({
          code: `PACK_${hookName.toUpperCase()}_FAILED`,
          message: `${pack.manifest.metadata.name} ${hookName} hook failed`,
          path: pack.root,
          cause: error,
        });

        if (collectIssues) {
          issues.push({
            code: `PACK_${hookName.toUpperCase()}_FAILED`,
            message: errorMessage(maestroError),
          });
          continue;
        }

        throw maestroError;
      }
    }
  }

  return issues;
}
