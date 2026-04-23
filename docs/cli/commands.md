# CLI

The npm package installs a `maestro` command. Use that command as the public entry point for workspace setup, workspace-managed Git branch operations, isolated worktrees, and validation. For install options, see [CLI install](./install.md).

```bash
maestro --help
maestro self upgrade
maestro init my-workspace
cd my-workspace
maestro workspace install --workspace . --dry-run
maestro workspace install --workspace .
maestro editor-workspace --workspace .
maestro repo bootstrap --workspace .
maestro workspace doctor --workspace .
```

The CLI is organized into grouped verbs. Top-level commands delegate to subcommands under `workspace`, `repo`, `worktree`, `editor-workspace`, and `self`. The only ungrouped verb is `init`.

The core lifecycle is:
`init` creates the workspace contract, you edit `maestro.yaml` to declare repositories, `workspace install` initializes the workspace root Git repository when needed, creates the `🪄 booted by Maestro` commit when the repository is unborn, and materializes the workspace and runtime projections, `editor-workspace` generates the optional VS Code multi-root file, `repo bootstrap` prepares repository dependencies, and `workspace doctor` validates the installed result. The root help screen also shows the currently installed Maestro version and the supported upgrade commands for npm and Homebrew installs.

## Common options

- `--workspace <path>`: target workspace directory. Defaults to the current directory.
- `--dry-run`: preview the plan without writing or executing, where applicable.
- `--format <human|json>`: select the output format. See [Output formats](#output-formats) for precedence.
- `--json`: shorthand for `--format json`.
- `--no-color`: disable ANSI color in human output. Also respects `NO_COLOR` and `FORCE_COLOR` env vars.

All `workspace`, `repo`, `worktree`, and `editor-workspace` commands emit a structured report. The format is human-readable on an interactive terminal and JSON when stdout is piped or redirected; see [Output formats](#output-formats) for the full precedence rules and the JSON envelope spec.

## Output formats

Maestro commands are output-format-agnostic: the same domain report is rendered through a human formatter (tables, colored status lines, grouped issues) or as stable JSON, chosen at invocation time.

### Defaults

- Interactive terminal (stdout is a TTY) → `human`.
- Piped or redirected stdout (scripts, CI logs, `| jq`) → `json`.

Progress and log output always go to stderr, so JSON consumers can pipe stdout directly into `jq` without interference.

### Precedence

From highest to lowest priority:

1. `--json` (explicit flag; equivalent to `--format json`).
2. `--format <human|json>` (explicit flag).
3. `MAESTRO_FORMAT=<human|json>` (environment variable).
4. TTY detection: `human` if `process.stdout.isTTY`, otherwise `json`.

### JSON envelope

Success output on **stdout**:

```json
{
  "data": { "status": "ok", "...": "report-specific fields" },
  "schemaVersion": 1
}
```

Error output on **stderr** (stdout stays empty or ends before the error):

```json
{
  "error": {
    "code": "WORKSPACE_NOT_FOUND",
    "message": "No maestro.yaml found at /tmp/nope",
    "details": { "path": "/tmp/nope" }
  },
  "schemaVersion": 1
}
```

`details` is optional and included only when the error carries structured context.

### Error codes

The `error.code` field is one of:

- `WORKSPACE_NOT_FOUND`
- `WORKSPACE_LOCKED`
- `REPO_MISSING`
- `REPO_DIRTY`
- `WORKTREE_NOT_FOUND`
- `WORKTREE_METADATA_MISSING`
- `GIT_OPERATION_FAILED`
- `MANIFEST_INVALID`
- `BOOTSTRAP_FAILED`
- `PERMISSION_DENIED`
- `UNEXPECTED`

The canonical list lives in `src/cli/output/renderer.ts`.

### Exit codes

- `0`: report `status` is `ok` or `warning`.
- `1`: report `status` is `error`, or an unhandled exception propagated out of the command.

`warning` never exits non-zero; use the report body (or a `jq` filter on `.data.status`) to branch on warnings in scripts.

### Color

Human output uses ANSI color by default when stdout is a TTY. To disable:

- Pass `--no-color`.
- Set `NO_COLOR=1` in the environment.

To force color (useful when piping through a pager that preserves ANSI):

- Set `FORCE_COLOR=1`.

Maestro delegates color detection to [`picocolors`](https://github.com/alexeyraspopov/picocolors), which honors these conventions natively.

### Scripting

Pipe the JSON envelope into `jq` and read the report via `.data`:

```bash
maestro repo list --workspace . --json | jq '.data.repositories[]'
```

Branch on report status without relying on exit codes:

```bash
maestro workspace doctor --workspace . --json \
  | jq -e '.data.status == "ok"' > /dev/null \
  && echo "clean" || echo "issues found"
```

On error, parse the stderr envelope:

```bash
maestro workspace install --workspace /bad/path --json 2> err.json
jq '.error.code' err.json
```

## `init`

Create a minimal multi-repo workspace with a manifest, package scripts, `AGENTS.md`, the neutral `maestro.json` descriptor, and `.maestro/` as the internal state root.

By default, `init` enables Codex and Claude Code only. Add `--runtimes opencode` when you want OpenCode projections in the scaffold.

After `init`, the normal next step is to edit `maestro.yaml` and add the repositories you want Maestro to manage. The next safe command is then usually `maestro workspace install --workspace . --dry-run`.

## `workspace`

Commands that operate on the workspace as a whole: installation, refresh, cleanup, and validation.

### `workspace install`

Resolve packs, merge fragments, write the lockfile, initialize the workspace root Git repository when needed, create the `🪄 booted by Maestro` commit when the repository is unborn, clone repositories, and project workspace, runtime, and execution artifacts.

In the first-run lifecycle, `workspace install` is the command that turns the workspace contract into a usable directory. It does not run dependency bootstrap automatically. It initializes the workspace root Git repository first when the workspace is not already under Git, creates the boot commit when the repository is unborn, then materializes the repositories and leaves dependency installation to `repo bootstrap`.

That projection refreshes `maestro.json` as the canonical machine-readable workspace view, while `.maestro/` stores the internal lockfile, state, and reports. When Codex and Claude Code are enabled, `workspace install` also generates `.codex/` and `.claude/` for the workspace.

Repository checkout scope comes from `spec.repositories[].sparse`. Omit that field for a full clone, or use `includePaths` / `excludePaths` together to keep the checked-out tree narrow while hiding nested files or folders you do not want materialized.

### `workspace update`

Rerun resolution and regenerate projected artifacts.

### `workspace prune`

Remove repositories that were removed from the manifest when their working tree is clean, then rerun `workspace install`. This command removes stale state left behind when repositories disappear from the manifest.

For this cleanliness check, Maestro intentionally ignores untracked files (`git status --porcelain --untracked-files=no`). Untracked files are treated as local scratch material and do not block prune cleanup; only tracked changes block the operation.

### `workspace doctor`

Check the lockfile, remotes, branches, sparse paths, runtime artifacts, generated workspace artifacts, execution artifacts, and validation hooks.

This command is most useful after `workspace install` has materialized repositories and generated artifacts, and after `repo bootstrap` if you want to validate the full first-run workflow. On a freshly scaffolded workspace, warnings about missing lockfiles, repositories, or projections are expected until install has run.

As the release hardening work lands, this command is also the right place to report missing safety artifacts such as invalid workspace-relative paths or stale shared-state outputs.

## `editor-workspace`

Generate the optional `maestro.code-workspace` file for editors that support named multi-root workspaces.

Use this command after `workspace install` when you want the explicit editor projection. The workspace root itself remains the canonical portable entrypoint for workspace-contract edits. After install, it is also a Git repository when needed, with the boot commit in place when the repository starts unborn, but the generated file is the clearest way to open the workspace plus each managed repository in VS Code.

Manifest-relative paths are expected to remain inside the workspace root. Path resolution should reject escapes rather than silently writing outside the workspace.

## `repo`

Commands that operate across the managed repositories in the workspace.

### `repo list`

List repositories declared in the workspace manifest with branch, remote, and install status.

Use this command to enumerate the managed repositories and confirm which are already installed under `repos/<name>`.

### `repo bootstrap`

Detect the install strategy and run dependency bootstrap per repository, from explicit commands or auto-detected manifests and lockfiles. Auto mode detects `composer`, `uv`, `npm`, `pnpm`, `yarn`, and `bun` from the materialized repositories.

Use this command after `workspace install` when the workspace should prepare dependencies inside the cloned repositories. In practice, `repo bootstrap` is the step that turns cloned repositories into working local projects.

This is not a generic dependency upgrade command. Maestro runs the repository bootstrap strategy declared in `spec.repositories[].bootstrap`:

- `strategy: manual` runs the explicit `commands` from the manifest.
- `strategy: auto` inspects the materialized repository and chooses install/sync commands from the manifests and lockfiles it finds.

In auto mode, the command is intentionally lockfile-aware:

- Composer: `composer install --no-interaction --prefer-dist`
- uv: `uv sync`
- npm with `package-lock.json`: `npm ci`
- pnpm with `pnpm-lock.yaml`: `pnpm install --frozen-lockfile`
- Yarn with `yarn.lock`: `yarn install --immutable`
- Bun with `bun.lock` or `bun.lockb`: `bun install`

When the manifest exists but the expected lockfile is missing, Maestro does not fall back to a resolver command. It reports a warning for that repository instead.

Use `--dry-run` when you want the exact per-repository commands without executing them. Lockfile warnings are reported per repository when auto mode cannot run safely.

Examples:

```bash
maestro repo bootstrap --workspace .
maestro repo bootstrap --workspace . --repository foodpilot-api
maestro repo bootstrap --workspace ./examples/ops-workspace --dry-run
```

Use `--repository <name>` to target one repository at a time.

### `repo git`

Run workspace-scoped Git operations across the repositories declared in the manifest. This namespace operates on the materialized repositories under `repos/`; it is not a general-purpose Git proxy.

#### `repo git checkout`

Check out each managed repository onto its reference branch from `spec.repositories[].branch`. If the field is omitted, Maestro resolves it to `main`.

The command reports failures repo by repo when a working tree is dirty or a checkout cannot be completed safely. It does not switch unrelated repositories when one repository fails.

Dirty checks in this workflow intentionally ignore untracked files (`--untracked-files=no`). This prevents local scratch files from blocking branch alignment while still protecting tracked file changes.

#### `repo git pull`

Pull the currently checked out branch from `origin` in each managed repository with fast-forward-only semantics.

The command does not switch branches and tolerates a dirty working tree: uncommitted tracked changes are auto-stashed before the fast-forward and restored afterwards. The command reports failures repo by repo for detached HEAD state, in-progress merges or rebases, and non-fast-forward pull attempts.

When restoring the stash would produce conflicts with upstream changes, the pull is aborted for that repository: `HEAD` is reset to its pre-pull commit and local changes are preserved in `git stash list` so nothing is lost. Run `git stash pop` manually after reconciling.

#### `repo git sync`

Check out each managed repository onto its manifest reference branch, then pull that branch from `origin` in one command.

This is the explicit composite for users who want the `checkout` then `pull` workflow without running two separate commands. If checkout fails for one repository, Maestro reports that repository as failed and does not pull it.

As with `checkout` and `pull`, clean-state checks in `sync` ignore untracked files (`--untracked-files=no`) by design.

Dynamic Git arguments should be treated as data, not flags. The implementation rule for that safety check lives in [`docs/architecture/technical-stack.md`](../architecture/technical-stack.md).

## `worktree`

Create, list, and remove isolated task worktrees spanning the workspace and its managed repositories.

The generated task root is the unit to open in the editor. It contains the workspace-root worktree plus each managed repository worktree, so one task can span the full workspace without opening repo folders separately.

When shared workspace state or report files are involved, worktree and related commands should prefer explicit lock discipline over implicit last-writer-wins behavior.

### `worktree create`

Create an isolated task worktree for the workspace and its managed repositories. The command creates a dedicated worktree for the workspace root when possible, and one worktree per managed repository under the task name.

Use `--task <name>` to name the task. `--dry-run` previews the plan without writing.

```bash
maestro worktree create --workspace . --task release-prep
```

Users should not need to assemble repository-specific worktrees by hand.

### `worktree list`

Enumerate task worktrees for this workspace with their creation time and root path.

```bash
maestro worktree list --workspace .
```

### `worktree remove`

Remove the task worktree for the workspace and its managed repositories. Committed work remains on the task branches; uncommitted work is preserved unless `--force` is passed.

```bash
maestro worktree remove --workspace . --task release-prep
maestro worktree remove --workspace . --task release-prep --force
```

Use `--force` to drop uncommitted changes and remove worktrees anyway. `--dry-run` previews the removal plan without touching the working tree.

## `self`

CLI-level maintenance operations.

### `self upgrade`

Detect the install path and run the upgrade for the published CLI.

```bash
maestro self upgrade
```

The command detects `npm` or `homebrew` from the installed CLI path and runs the matching update flow. If detection is not possible, Maestro falls back to the npm update command.

## Support boundary

- Supported in the published framework: the CLI, workspace manifests, packs, runtime projection, workspace-managed Git branch/update operations, and worktree isolation.
- Operational guarantees under active hardening: workspace-bounded path resolution, safer command execution, clearer failure reporting, and stronger test/process isolation.
- Not covered by the published CLI and manifest contract: downstream user-facing agent catalogs, hosted execution, and any guarantee beyond the documented behavior. The `.codex/` and `.claude/` wrappers used to develop Maestro itself are separate from the published framework.
