# CLI

The npm package installs a `maestro` command. Use that command as the public entry point for workspace setup, workspace-managed Git branch operations, isolated worktrees, and validation. For install options, see [CLI install](./install.md).

```bash
maestro --help
maestro init my-workspace
cd my-workspace
maestro install --workspace . --dry-run
maestro install --workspace .
maestro code-workspace --workspace .
maestro bootstrap --workspace .
maestro doctor --workspace .
```

The core lifecycle is:
`init` creates the workspace contract, you edit `maestro.yaml` to declare repositories, `install` initializes the workspace root Git repository when needed, creates the `🪄 booted by Maestro` commit when the repository is unborn, and materializes the workspace and runtime projections, `code-workspace` generates the optional VS Code multi-root file, `bootstrap` prepares repository dependencies, and `doctor` validates the installed result.

## `init`

Create a minimal multi-repo workspace with a manifest, package scripts, `AGENTS.md`, the neutral `maestro.json` descriptor, and `.maestro/` as the internal state root.

By default, `init` enables Codex and Claude Code only. Add `--runtimes opencode` when you want OpenCode projections in the scaffold.

After `init`, the normal next step is to edit `maestro.yaml` and add the repositories you want Maestro to manage. The next safe command is then usually `maestro install --workspace . --dry-run`.

## `install`

Resolve packs, merge fragments, write the lockfile, initialize the workspace root Git repository when needed, create the `🪄 booted by Maestro` commit when the repository is unborn, clone repositories, and project workspace, runtime, and execution artifacts.

In the first-run lifecycle, `install` is the command that turns the workspace contract into a usable directory. It does not run dependency bootstrap automatically. It initializes the workspace root Git repository first when the workspace is not already under Git, creates the boot commit when the repository is unborn, then materializes the repositories and leaves dependency installation to `bootstrap`.

That projection refreshes `maestro.json` as the canonical machine-readable workspace view, while `.maestro/` stores the internal lockfile, state, and reports. When Codex and Claude Code are enabled, `install` also generates `.codex/` and `.claude/` for the workspace.

Repository checkout scope comes from `spec.repositories[].sparse`. Omit that field for a full clone, or use `includePaths` / `excludePaths` together to keep the checked-out tree narrow while hiding nested files or folders you do not want materialized.

## `code-workspace`

Generate the optional `maestro.code-workspace` file for editors that support named multi-root workspaces.

Use this command after `install` when you want the explicit editor projection. The workspace root itself remains the canonical portable entrypoint for workspace-contract edits. After `install`, it is also a Git repository when needed, with the boot commit in place when the repository starts unborn, but the generated file is the clearest way to open the workspace plus each managed repository in VS Code.

Manifest-relative paths are expected to remain inside the workspace root. Path resolution should reject escapes rather than silently writing outside the workspace.

## `bootstrap`

Build or execute repository bootstrap commands from the workspace configuration. Auto mode detects `composer`, `uv`, `npm`, `pnpm`, `yarn`, and `bun` from the materialized repositories.

Use this command after `install` when the workspace should prepare dependencies inside the cloned repositories. In practice, `bootstrap` is the step that turns cloned repositories into working local projects.

Examples:

```bash
maestro bootstrap --workspace .
maestro bootstrap --workspace . --repository foodpilot-api
maestro bootstrap --workspace ./examples/ops-workspace --dry-run
```

Use `--repository <name>` to target one repository at a time.

## `sync`

Remove repositories that were removed from the manifest when their working tree is clean, then rerun `install`.

For this cleanliness check, Maestro intentionally ignores untracked files (`git status --porcelain --untracked-files=no`). Untracked files are treated as local scratch material and do not block sync cleanup; only tracked changes block the operation.

## `update`

Rerun resolution and regenerate projected artifacts.

## `doctor`

Check the lockfile, remotes, branches, sparse paths, runtime artifacts, generated workspace artifacts, execution artifacts, and validation hooks.

This command is most useful after `install` has materialized repositories and generated artifacts, and after `bootstrap` if you want to validate the full first-run workflow. On a freshly scaffolded workspace, warnings about missing lockfiles, repositories, or projections are expected until install has run.

As the release hardening work lands, this command is also the right place to report missing safety artifacts such as invalid workspace-relative paths or stale shared-state outputs.

## `git`

Run workspace-managed Git operations across the repositories declared in the manifest. This namespace operates on the materialized repositories under `repos/`; it is not a general-purpose Git proxy.

### `git checkout`

Check out each managed repository onto its reference branch from `spec.repositories[].branch`. If the field is omitted, Maestro resolves it to `main`.

The command reports failures repo by repo when a working tree is dirty or a checkout cannot be completed safely. It does not switch unrelated repositories when one repository fails.

Dirty checks in this workflow intentionally ignore untracked files (`--untracked-files=no`). This prevents local scratch files from blocking branch alignment while still protecting tracked file changes.

### `git pull`

Pull the currently checked out branch from `origin` in each managed repository with fast-forward-only semantics.

The command does not switch branches. It reports failures repo by repo for detached HEAD state, dirty working trees, and non-fast-forward pull attempts.

Dirty checks in this workflow intentionally ignore untracked files (`--untracked-files=no`) so local untracked artifacts do not block fast-forward updates of tracked content.

### `git sync`

Check out each managed repository onto its manifest reference branch, then pull that branch from `origin` in one command.

This is the explicit composite for users who want the `checkout` then `pull` workflow without running two separate commands. If checkout fails for one repository, Maestro reports that repository as failed and does not pull it.

As with `checkout` and `pull`, clean-state checks in `sync` ignore untracked files (`--untracked-files=no`) by design.

Dynamic Git arguments should be treated as data, not flags. The implementation rule for that safety check lives in [`docs/architecture/technical-stack.md`](../architecture/technical-stack.md).

## `worktree`

Prepare an isolated task workspace for one task. The command creates a dedicated worktree for the workspace root when possible, and one worktree per managed repository under the task name.

The generated task root is the unit to open in the editor. It contains the workspace-root worktree plus each managed repository worktree, so one task can span the full workspace without opening repo folders separately.

When shared workspace state or report files are involved, worktree and related commands should prefer explicit lock discipline over implicit last-writer-wins behavior.

Users should not need to assemble repository-specific worktrees by hand.

## Support boundary

- Supported in the published framework: the CLI, workspace manifests, packs, runtime projection, workspace-managed Git branch/update operations, and worktree isolation.
- Operational guarantees under active hardening: workspace-bounded path resolution, safer command execution, clearer failure reporting, and stronger test/process isolation.
- Not covered by the published CLI and manifest contract: downstream user-facing agent catalogs, hosted execution, and any guarantee beyond the documented behavior. The `.codex/` and `.claude/` wrappers used to develop Maestro itself are separate from the published framework.
