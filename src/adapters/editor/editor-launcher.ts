import { execa } from "execa";
import type { EditorLaunch } from "../../core/execution/editor-launch.js";

/**
 * Starts the editor and waits for its launcher to return (`open -a`, `code`, a JetBrains
 * launcher, or a custom shell command). Its output is captured so stdout stays reserved for
 * the task path; a launcher that is missing or exits non-zero rejects with its stderr.
 */
export async function launchEditorProcess(launch: EditorLaunch): Promise<void> {
  if ("shell" in launch) {
    await execa("sh", ["-c", launch.shell], { stdin: "ignore" });
    return;
  }
  await execa(launch.command, launch.args, { stdin: "ignore" });
}
