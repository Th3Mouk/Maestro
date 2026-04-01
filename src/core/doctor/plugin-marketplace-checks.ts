import path from "node:path";
import type { DoctorReport } from "../../report/types.js";
import { pathExists, readText, resolveSafePath } from "../../utils/fs.js";
import { errorMessage, MaestroError } from "../errors.js";
import { pushDoctorWarning } from "./reporting.js";

interface MarketplacePlugin {
  name?: string;
  source?: {
    path?: string;
    source?: string;
  };
}

interface PluginMarketplace {
  plugins?: MarketplacePlugin[];
}

export async function runPluginMarketplaceChecks(
  workspaceRoot: string,
  report: DoctorReport,
): Promise<void> {
  const marketplacePath = resolveSafePath(
    workspaceRoot,
    path.join(".agents", "plugins", "marketplace.json"),
    "plugin marketplace",
  );

  if (!(await pathExists(marketplacePath))) {
    return;
  }

  try {
    const marketplace = JSON.parse(await readText(marketplacePath)) as PluginMarketplace;
    for (const plugin of marketplace.plugins ?? []) {
      if (plugin.source?.source !== "local" || !plugin.source.path) {
        continue;
      }

      const pluginRoot = resolveSafePath(
        workspaceRoot,
        plugin.source.path,
        `plugin source for ${plugin.name ?? "unknown plugin"}`,
      );
      const hasCodexManifest = await pathExists(
        path.join(pluginRoot, ".codex-plugin", "plugin.json"),
      );
      const hasClaudeManifest = await pathExists(
        path.join(pluginRoot, ".claude-plugin", "plugin.json"),
      );
      if (!hasCodexManifest && !hasClaudeManifest) {
        pushDoctorWarning(report, {
          code: "PLUGIN_MANIFEST_MISSING",
          message: `Plugin is missing a native manifest: ${plugin.name ?? plugin.source.path}`,
          path: pluginRoot,
        });
      }
    }
  } catch (error) {
    pushDoctorWarning(report, {
      code: "PLUGIN_MARKETPLACE_INVALID",
      message: errorMessage(
        new MaestroError({
          code: "PLUGIN_MARKETPLACE_INVALID",
          message: "Plugin marketplace content is invalid.",
          path: marketplacePath,
          cause: error,
        }),
      ),
      path: marketplacePath,
    });
  }
}
