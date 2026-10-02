import { isExecutableOnPath } from "../../utils/fs.js";

/** What to open: the task root, and its editor workspace file when it has one. */
export interface EditorTarget {
  root: string;
  workspaceFile?: string;
}

/** A process to start: an executable with its arguments, or a shell command. */
export type EditorLaunch = { command: string; args: string[] } | { shell: string };

interface EditorLaunchEnvironment {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
}

const workspaceFileEditors: Record<string, { app: string; cli: string }> = {
  vscode: { app: "Visual Studio Code", cli: "code" },
  cursor: { app: "Cursor", cli: "cursor" },
  devin: { app: "Devin", cli: "devin-desktop" },
};

const jetBrainsEditors: Record<string, { app: string; cli: string }> = {
  phpstorm: { app: "PhpStorm", cli: "phpstorm" },
  idea: { app: "IntelliJ IDEA", cli: "idea" },
  webstorm: { app: "WebStorm", cli: "webstorm" },
};

const builtInEditorIds = [
  ...Object.keys(workspaceFileEditors),
  ...Object.keys(jetBrainsEditors),
  "none",
  "custom",
];

/** `--editor`, else `$MAESTRO_EDITOR`, else the manifest's `editor`, else `vscode`. */
export function resolveEditorId(
  requested: string | undefined,
  env: NodeJS.ProcessEnv,
  manifestEditor: string | undefined,
): string {
  return requested || env.MAESTRO_EDITOR || manifestEditor || "vscode";
}

/**
 * How to open `target` in `editorId`; `undefined` for `none`. A JetBrains IDE uses its CLI
 * launcher when it is on PATH, else the macOS app. Throws for an unknown editor, or a custom
 * one without `$MAESTRO_EDITOR_COMMAND`.
 */
export async function buildEditorLaunch(
  editorId: string,
  target: EditorTarget,
  environment: EditorLaunchEnvironment,
): Promise<EditorLaunch | undefined> {
  if (editorId === "none") {
    return undefined;
  }

  const fileEditor = workspaceFileEditors[editorId];
  if (fileEditor) {
    const opened = target.workspaceFile ?? target.root;
    return environment.platform === "darwin"
      ? { command: "open", args: ["-a", fileEditor.app, opened] }
      : { command: fileEditor.cli, args: [opened] };
  }

  const jetBrains = jetBrainsEditors[editorId];
  if (jetBrains) {
    if (
      environment.platform !== "darwin" ||
      (await isExecutableOnPath(jetBrains.cli, environment.env))
    ) {
      return { command: jetBrains.cli, args: [target.root] };
    }
    return { command: "open", args: ["-na", jetBrains.app, "--args", target.root] };
  }

  if (editorId === "custom") {
    const template = environment.env.MAESTRO_EDITOR_COMMAND;
    if (!template) {
      throw new Error("--editor custom needs $MAESTRO_EDITOR_COMMAND, e.g. 'zed {root}'.");
    }
    return {
      shell: template
        .replaceAll("{root}", shellQuote(target.root))
        .replaceAll("{workspaceFile}", shellQuote(target.workspaceFile ?? target.root)),
    };
  }

  throw new Error(
    `Unknown editor "${editorId}"; use one of ${builtInEditorIds.join(", ")}, or custom with $MAESTRO_EDITOR_COMMAND.`,
  );
}

export function describeEditorLaunch(launch: EditorLaunch): string {
  if ("shell" in launch) {
    return launch.shell;
  }
  return [launch.command, ...launch.args].map(shellQuoteIfNeeded).join(" ");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function shellQuoteIfNeeded(value: string): string {
  return /^[\w@%+=:,./-]+$/.test(value) ? value : shellQuote(value);
}
