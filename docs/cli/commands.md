# CLI

The npm package installs a `maestro` command. Use that command as the public entry point for workspace setup, workspace-managed Git branch operations, isolated worktrees, and validation. For install options, see [CLI install](./install.md).

```bash
maestro --help
maestro self upgrade
maestro init my-workspace
cd my-workspace
maestro workspace install --dry-run
maestro workspace install
maestro editor-workspace
maestro repo bootstrap
maestro workspace doctor
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
maestro repo list --json | jq '.data.repositories[]'
```

Branch on report status without relying on exit codes:

```bash
maestro workspace doctor --json \
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

By default, `init` enables the `standard` runtime (skills in `.agents/skills/`) and the `claude-code` runtime (skills linked into `.claude/skills/`, workflows in `.claude/workflows/`). `--runtimes` accepts a comma-separated list of `standard`, `claude-code`, `codex`, `cursor`, `copilot`, `gemini`, `opencode`, `kilo`, and `devin`; the runtimes that only read agents are scaffolded with `agents: { mode: merge }`.

`init` never writes `CLAUDE.md`. Claude Code reads `AGENTS.md` when no `CLAUDE.md` exists; see [Instruction files](../manifests/workspace.md#instruction-files-agentsmd-and-claudemd).

After `init`, the normal next step is to edit `maestro.yaml` and add the repositories you want Maestro to manage. The next safe command is then usually `maestro workspace install --dry-run`.

## `workspace`

Commands that operate on the workspace as a whole: installation, refresh, cleanup, and validation.

### `workspace install`

Resolve packs, merge fragments, write the lockfile, initialize the workspace root Git repository when needed, create the `🪄 booted by Maestro` commit when the repository is unborn, clone repositories, and project workspace, runtime, and execution artifacts.

In the first-run lifecycle, `workspace install` is the command that turns the workspace contract into a usable directory. It does not run dependency bootstrap automatically. It initializes the workspace root Git repository first when the workspace is not already under Git, creates the boot commit when the repository is unborn, then materializes the repositories and leaves dependency installation to `repo bootstrap`.

That projection refreshes `maestro.json` as the canonical machine-readable workspace view, while `.maestro/` stores the internal lockfile, state, and reports. It also projects skills, agents, and workflows into the directories of the runtimes enabled in `spec.runtimes`, or into the canonical layout (`.agents/skills/`, `.claude/skills/`, `.claude/workflows/`) when `spec.runtimes` is omitted. It does not write `CLAUDE.md`, `.mcp.json`, hooks, or runtime settings; it only merges declared plugin activation into `.claude/settings.json`.

By default, projection only touches the names Maestro is about to write, so hand-placed or third-party skills, agents, and workflows already there survive (`mode: merge`). Set `mode: replace` on an asset, or `projectionMode: replace` on a runtime, to wipe the target directory on every install instead. See [Runtime projection](../manifests/workspace.md#runtime-projection).

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

Each entry in `repositories[]` reports a `state` of `executed`, `skipped`, or `failed`. `failed` means the bootstrap command for that repository exited non-zero; cross-reference `issues[].path` for the underlying command and error output. A per-repository command failure raises the report `status` to `warning`, consistent with the exit code convention above: the process still exits `0`, so scripts that need per-repository pass/fail should branch on `repositories[].state` (or `issues`), not on the exit code.

Examples:

```bash
maestro repo bootstrap
maestro repo bootstrap --repository foodpilot-api
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

Create, list, remove, and prune isolated task worktrees spanning the workspace and its managed repositories.

The generated task root is the unit to open in the editor. It contains the workspace-root worktree plus each managed repository worktree, so one task can span the full workspace without opening repo folders separately.

When shared workspace state or report files are involved, worktree and related commands should prefer explicit lock discipline over implicit last-writer-wins behavior.

Every `worktree` subcommand can run from inside a task root. When the resolved `--workspace` (the current directory by default) contains `.maestro/execution/worktree.json`, Maestro resolves the main workspace through `git rev-parse --git-common-dir`, operates on it, and reports a `WORKSPACE_RESOLVED_FROM_TASK` issue naming both paths. A task worktree is never created under another task. If the main workspace cannot be resolved, the command fails with `WORKSPACE_IS_TASK_WORKTREE`.

### `worktree create`

Create an isolated task worktree for the workspace and its managed repositories. The command creates a dedicated worktree for the workspace root when possible, and one worktree per managed repository under the task name.

Use `--task <name>` to name the task. `--dry-run` previews the plan without writing.

```bash
maestro worktree create --task release-prep
maestro worktree create --task fix-login --repos foods,platform-api
```

By default every managed repository gets a worktree. `--repos <a,b>` checks out only the listed repositories: the others are absent from `<taskRoot>/repos/`, never linked to the primary clone, so an edit cannot land there by mistake. Running `create --repos` again on an existing task adds the repositories it does not have yet and leaves the others untouched; it never removes one. A name the manifest does not declare fails the command with `REPO_UNKNOWN`, and nothing is created.

The task records the repositories it holds in `.maestro/execution/worktree.json` (`repositories`). `worktree list` and `worktree remove` use that list rather than the manifest, and the task's `maestro.json` descriptor lists only those repositories.

Each checkout gets a task branch named `<branchPrefix>/<task>/<repository>` (`<branchPrefix>/<task>/<workspace>` for the workspace root). When that branch already exists, for example after `worktree remove` kept it, Maestro checks it out as is and reports the repository as `reused`: its commits stay on it. A missing branch is created from the base ref and reported as `created`. A repository whose worktree is already in place is reported as `unchanged`.

The base ref of a new branch is:

- for the workspace root, the workspace's default branch: `origin/HEAD`'s target when it resolves, else `main` (never the branch the root checkout currently sits on);
- for a repository, `origin/<branch>` of its reference branch, fetched first (`git fetch origin <branch>`) so a stale local branch does not become the task's base. If the fetch fails, Maestro reports a `FETCH_FAILED` warning and uses the local reference branch. `--offline` skips the fetch and uses the local reference branch.

Reused branches are never moved, and the primary clones' checked-out branches are left alone.

Users should not need to assemble repository-specific worktrees by hand.

### `worktree list`

Enumerate task worktrees for this workspace with their creation time, root path, and the repositories each one holds.

```bash
maestro worktree list
maestro worktree list --status
```

`--status` inspects every checkout of each task, concurrently, and adds `checkouts` (the workspace root first, named after the workspace, then each repository) and `prunable` to each worktree. Without it, `list` reads only the task metadata and stays fast. Each checkout reports:

| Field        | Meaning                                                                                                                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `branch`     | Current branch, `null` when detached.                                                                                                                                                                                                   |
| `dirty`      | `git status --porcelain` lists something: untracked files count, ignored files do not, and neither do unedited files Maestro wrote into the task root.                                                                                  |
| `localOnly`  | Commits no remote-tracking branch holds (`git rev-list HEAD --not --remotes`).                                                                                                                                                          |
| `upstream`   | `tracking`, `gone` (an upstream is configured but its remote branch was deleted), or `none`.                                                                                                                                            |
| `integrated` | The branch's work is in the reference branch: its tip is an ancestor of `origin/<reference>`, or the squash of `merge-base..tip` is patch-equivalent to a commit on it. The squash check catches branches merged by squash and deleted. |

`prunable` applies the `worktree prune` rule below without `--include-gone`.

### `worktree remove`

Remove the task worktree for the workspace and its managed repositories. Committed work remains on the task branches; uncommitted work is never deleted unless `--force` is passed.

```bash
maestro worktree remove --task release-prep
maestro worktree remove --task release-prep --force
```

Before removing anything, Maestro checks every checkout of the task: the workspace-root worktree and each repository worktree. A checkout is dirty when `git status --porcelain` lists anything, untracked files included. Ignored files (`vendor/`, `node_modules/`) do not count. If any checkout is dirty, the task is left untouched, the report status is `error` (exit code `1`), and each dirty checkout gets a `WORKTREE_DIRTY` issue with its `path` and `changedFiles` count. The task root is deleted only after every `git worktree remove` succeeded.

Use `--force` to discard uncommitted changes and remove the worktrees anyway. `--dry-run` runs the same dirty check and previews the removal plan without touching the working tree.

### `worktree prune`

Remove every task whose work has landed, and delete its task branches.

```bash
maestro worktree prune --dry-run
maestro worktree prune
maestro worktree prune --include-gone --branches
maestro worktree prune --task release-prep --dry-run
```

- Maestro first runs `git fetch --prune` on the workspace and each repository, so `upstream` and `integrated` reflect the remote. `--no-fetch` skips it.
- A task is prunable when every checkout is clean (`dirty: false`) and, for each, `localOnly` is `0` or `integrated` is true.
- `--include-gone` also treats a clean checkout whose `upstream` is `gone` as landed. This covers squash merges the patch comparison misses, for example after conflict resolution. It is off by default, because a deleted remote branch is not proof the work landed.
- Prunable tasks are removed through the same path as `worktree remove`, then the task branches their checkouts had checked out are deleted with `git branch -D`.
- `--branches` also deletes orphan task branches: branches matching `<branchPrefix>/*/*` that no worktree has checked out and whose task is gone, under the same rule. Branches holding unintegrated commits are kept and listed.
- `--task <name>` (repeatable) restricts `prune` to those tasks: only the workspace and their repositories are fetched, and the other tasks are neither inspected nor touched. With `--branches`, only the orphan branches of those task names (`<branchPrefix>/<name>/*`) are considered. A name with no task directory (and, with `--branches`, no task branch) fails the command with `WORKTREE_NOT_FOUND` before anything is fetched or removed. Use it to check or clean up one task, or to try a workspace's `preRemove` hooks on one task.
- `--dry-run` prints the plan, writing nothing but the fetched remote-tracking refs: the tasks it would remove, the branches it would delete, and the kept items.
- The primary clones' checked-out branches are never touched.

The `worktree-prune` report has the shape `{ removed: [...], deletedBranches: [{ name, branch }], kept: [{ name, reasons: [...] }], hooks, issues }`, where reasons read like `dirty: foods` or `2 local-only commits in platform-api`. `prune` only handles worktrees and branches; workspaces that own containers, databases, or proxy routes per task tear them down from a `preRemove` hook (below), which `prune` runs for each task it removes.

### Lifecycle hooks

A workspace plugs its own setup and teardown into the task lifecycle with `spec.execution.worktrees.hooks`:

```yaml
spec:
  execution:
    worktrees:
      hooks:
        postCreate:
          - ./scripts/seed-deps
        preRemove:
          - ./scripts/platform-down "$MAESTRO_TASK" --keep-worktree
```

Each command runs with `sh -c` from the main workspace root, one after the other in declaration order; the first failing command stops the others. Packs can provide the same hooks (`provides.hooks.worktreePostCreate` and `provides.hooks.worktreePreRemove`), which run before the manifest's, with `MAESTRO_PACK_ROOT` set to the pack root so a pack can call its own scripts (`"$MAESTRO_PACK_ROOT/scripts/seed"`).

| Variable                    | Value                                             |
| --------------------------- | ------------------------------------------------- |
| `MAESTRO_TASK`              | task name, as created                             |
| `MAESTRO_TASK_ROOT`         | absolute task root                                |
| `MAESTRO_WORKSPACE_ROOT`    | absolute main workspace root                      |
| `MAESTRO_TASK_REPOSITORIES` | space-separated repositories that have a worktree |
| `MAESTRO_HOOK`              | `postCreate` or `preRemove`                       |
| `MAESTRO_TRIGGER`           | `create`, `remove`, or `prune`                    |

- `postCreate` runs once the task's metadata is written: on a new task, and when `create --repos` adds repositories to an existing one. A `create` that changed nothing does not run it. A failure makes the report a `warning` with a `HOOK_FAILED` issue (command, exit code, and the last lines of its stderr); the worktree stays, since only its setup failed.
- `preRemove` runs after the safety checks of `remove` or `prune` passed, and before anything is removed, so a task that turns out dirty never loses its platform while keeping its worktree. A failure aborts the removal of that task: `remove` fails with `HOOK_FAILED`, and `prune` keeps the task with the reason `preRemove hook failed (exit N)`. `remove --force` still runs the hook; a failure under `--force` is a `warning` and the removal goes on.
- `--no-hooks` on `create`, `remove`, and `prune` skips them. `--dry-run` never runs them and lists them as `planned`.
- Hook output (stdout and stderr) goes to Maestro's stderr, each line prefixed with `[postCreate]` or `[preRemove]`, so `--json` output on stdout stays parseable. Reports list the commands that ran under `hooks: [{ hook, command, status, exitCode, task }]`.

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
- Not covered by the published CLI and manifest contract: downstream user-facing agent catalogs, hosted execution, and any guarantee beyond the documented behavior. The `.agents/`, `.codex/`, and `.claude/` wrappers used to develop Maestro itself are separate from the published framework.
