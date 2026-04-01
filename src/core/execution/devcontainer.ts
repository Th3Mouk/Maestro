import type { ResolvedWorkspace } from "../../workspace/types.js";
import type { RepositoryBootstrapPlan } from "./bootstrap-plan.js";

export function renderDevcontainerDockerfile(
  plan: RepositoryBootstrapPlan[],
  resolvedWorkspace: ResolvedWorkspace,
): string {
  const toolchains = new Set(plan.flatMap((entry) => entry.toolchains));
  const packages = ["bash", "ca-certificates", "curl", "git", "unzip"];

  if (toolchains.has("node")) {
    packages.push("nodejs", "npm");
  }

  if (toolchains.has("python")) {
    packages.push("python3", "python3-pip", "python3-venv");
  }

  if (toolchains.has("php") || toolchains.has("composer")) {
    packages.push("composer", "php-cli", "php-curl", "php-mbstring", "php-xml");
  }

  const lines = [
    `FROM ${resolvedWorkspace.execution.devcontainer?.baseImage ?? "mcr.microsoft.com/devcontainers/base:ubuntu"}`,
    "",
    "ARG DEBIAN_FRONTEND=noninteractive",
    "",
    "RUN apt-get update \\",
    `  && apt-get install -y ${packages.join(" ")} \\`,
    "  && rm -rf /var/lib/apt/lists/*",
  ];

  if (toolchains.has("node")) {
    lines.push("", "RUN npm install -g corepack && corepack enable || true");
  }

  if (toolchains.has("uv")) {
    lines.push(
      "",
      "RUN curl -LsSf https://astral.sh/uv/install.sh | sh",
      'ENV PATH="/root/.local/bin:${PATH}"',
    );
  }

  return `${lines.join("\n")}\n`;
}

export function renderDevcontainerConfig(
  resolvedWorkspace: ResolvedWorkspace,
): Record<string, unknown> {
  const workspaceFolder =
    resolvedWorkspace.execution.devcontainer?.workspaceFolder ??
    `/workspace/${resolvedWorkspace.manifest.metadata.name}`;

  return {
    build: {
      context: "..",
      dockerfile: "Dockerfile",
    },
    customizations: {
      vscode: {
        settings: {
          "terminal.integrated.defaultProfile.linux": "bash",
        },
      },
    },
    init: true,
    name: `${resolvedWorkspace.manifest.metadata.name}-workspace`,
    postCreateCommand: "bash .devcontainer/bootstrap.sh",
    remoteUser: resolvedWorkspace.execution.devcontainer?.remoteUser ?? "vscode",
    updateRemoteUserUID: true,
    workspaceFolder,
    workspaceMount: `source=\${localWorkspaceFolder},target=${workspaceFolder},type=bind,consistency=cached`,
  };
}
