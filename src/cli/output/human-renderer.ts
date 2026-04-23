import pc from "picocolors";
import type { Renderer, RendererError } from "./renderer.js";
import type { HumanFormatContext } from "./human/shared.js";
import { formatInstallReport } from "./human/install.js";
import { formatBootstrapReport } from "./human/bootstrap.js";
import { formatDoctorReport } from "./human/doctor.js";
import { formatWorktreeCreateReport } from "./human/worktree-create.js";
import { formatWorktreeRemoveReport } from "./human/worktree-remove.js";
import { formatWorktreeListReport } from "./human/worktree-list.js";
import { formatRepoListReport } from "./human/repo-list.js";
import { formatWorkspaceGitReport } from "./human/workspace-git.js";
import type {
  BootstrapReport,
  DoctorReport,
  InstallReport,
  RepoListReport,
  TaskWorktreeReport,
  WorkspaceGitReport,
  WorktreeListReport,
  WorktreeRemoveReport,
} from "../../report/types.js";

export type HumanReportKind =
  | "install"
  | "bootstrap"
  | "doctor"
  | "worktree-create"
  | "worktree-remove"
  | "worktree-list"
  | "repo-list"
  | "workspace-git";

interface HumanRendererOptions {
  color?: boolean;
}

export class HumanRenderer implements Renderer {
  private readonly ctx: HumanFormatContext;

  constructor(
    private readonly reportKind: HumanReportKind,
    options: HumanRendererOptions = {},
  ) {
    this.ctx = { color: options.color ?? false };
  }

  render(report: unknown, stdout: NodeJS.WritableStream): void {
    const output = this.format(report);
    stdout.write(output);
  }

  renderError(error: RendererError, stderr: NodeJS.WritableStream): void {
    const errorLine = this.ctx.color
      ? pc.red(`Error: ${error.message}`)
      : `Error: ${error.message}`;
    const lines = [errorLine, `  Code: ${error.code}`];
    if (error.details) {
      lines.push("  Details:");
      for (const [key, value] of Object.entries(error.details)) {
        const serialized = typeof value === "string" ? value : JSON.stringify(value);
        lines.push(`    ${key}: ${serialized}`);
      }
    }
    stderr.write(`${lines.join("\n")}\n`);
  }

  private format(report: unknown): string {
    switch (this.reportKind) {
      case "install":
        return formatInstallReport(report as InstallReport, this.ctx);
      case "bootstrap":
        return formatBootstrapReport(report as BootstrapReport, this.ctx);
      case "doctor":
        return formatDoctorReport(report as DoctorReport, this.ctx);
      case "worktree-create":
        return formatWorktreeCreateReport(report as TaskWorktreeReport, this.ctx);
      case "worktree-remove":
        return formatWorktreeRemoveReport(report as WorktreeRemoveReport, this.ctx);
      case "worktree-list":
        return formatWorktreeListReport(report as WorktreeListReport, this.ctx);
      case "repo-list":
        return formatRepoListReport(report as RepoListReport, this.ctx);
      case "workspace-git":
        return formatWorkspaceGitReport(report as WorkspaceGitReport, this.ctx);
      default: {
        const exhaustive: never = this.reportKind;
        throw new Error(`Unknown report kind: ${String(exhaustive)}`);
      }
    }
  }
}
