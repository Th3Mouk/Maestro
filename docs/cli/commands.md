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

The CLI is organized into grouped verbs. Top-level commands delegate to subcommands under `workspace`, `repo`, `worktree`, `editor-workspace`, and `self`. The ungrouped verbs are `init` and `shell-init`.

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

That projection refreshes `maestro.json` as the canonical machine-readable workspace view, while `.maestro/` stores the internal lockfile, state, and reports. It also projects skills, agents, and workflows into the directories of the runtimes enabled in `spec.runtimes`, or into the canonical layout (`.agents/skills/`, `.claude/skills/`, `.claude/workflows/`) when `spec.runtimes` is omitted. It does not write `CLAUDE.md`, `.mcp.json`, hooks, or runtime settings; it only merges declared plugin activation, and the Maestro worktree hooks when `runtimes.claude-code.worktreeHooks` is on, into `.claude/settings.json`.

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

It also checks the task worktrees `maestro worktree list` cannot see from `rootDir`:

| Code                | Meaning                                                                                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `TASK_OUTSIDE_ROOT` | A worktree of the workspace root (`git worktree list`) lives outside `rootDir`, for example one created by another tool or by hand. `list` and `prune` do not see it.          |
| `TASK_NESTED`       | A workspace-root worktree lives inside another task's worktree, as invocations of Maestro before 0.7 could create.                                                             |
| `WORKTREE_PRUNABLE` | The workspace or a repository still registers a worktree whose directory is gone, which can hold its branch. `maestro workspace doctor --fix` runs `git worktree prune` there. |

`--fix` repairs only what is safe to repair (stale worktree registrations) and lists what it did under `fixes` in the report.

## `editor-workspace`

Generate the optional `maestro.code-workspace` file for editors that support named multi-root workspaces.

Use this command after `workspace install` when you want the explicit editor projection. The workspace root itself remains the canonical portable entrypoint for workspace-contract edits. After install, it is also a Git repository when needed, with the boot commit in place when the repository starts unborn, but the generated file is the clearest way to open the workspace plus each managed repository in VS Code.

Manifest-relative paths are expected to remain inside the workspace root. Path resolution should reject escapes rather than silently writing outside the workspace.

## `shell-init`

Print a shell function that switches to task worktrees. A child process cannot change its parent shell's directory, so `cd` into a task needs a function in the shell itself:

```bash
eval "$(maestro shell-init)"          # zsh or bash, in ~/.zshrc or ~/.bashrc
maestro shell-init fish | source      # fish, in ~/.config/fish/config.fish
```

`maestro shell-init [zsh|bash|fish]` defaults to the basename of `$SHELL` and prints a function named `mw` (`--name <name>` to change it). It is a thin wrapper:

- `mw <args>` runs `maestro worktree open <args> --format human`: the editor opens, the report goes to stderr, and the function `cd`s into the task root printed on stdout. `mw` alone opens the picker; `mw @root` goes back to the main workspace.
- `mw -l` runs `maestro worktree list --status`.
- `mw --prune …` runs `maestro worktree prune …`.

The function calls `maestro` from `PATH` and embeds no workspace path, so the rc line is the same on every machine. The workspace is the one around the current directory: worktree commands resolve it upward from any directory inside the workspace, a task root, or one of their repository checkouts.

`maestro shell-init --install` adds the loading line to the shell's rc file (`${ZDOTDIR:-$HOME}/.zshrc`, `~/.bashrc`, or `~/.config/fish/config.fish`) between `# >>> maestro shell-init >>>` and `# <<< maestro shell-init <<<`. Running it again replaces that block and keeps the rest of the file byte for byte; `--uninstall` removes it.

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

Every `worktree` subcommand resolves the workspace upward: from a subdirectory or a repository checkout, `--workspace` (the current directory by default) resolves to the closest enclosing workspace or task root. Every `worktree` subcommand can also run from inside a task root. When the resolved `--workspace` (the current directory by default) contains `.maestro/execution/worktree.json`, Maestro resolves the main workspace through `git rev-parse --git-common-dir`, operates on it, and reports a `WORKSPACE_RESOLVED_FROM_TASK` issue naming both paths. A task worktree is never created under another task. If the main workspace cannot be resolved, the command fails with `WORKSPACE_IS_TASK_WORKTREE`.

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

`--status` inspects every checkout of each task, concurrently, and adds `checkouts` (the workspace root first, named after the workspace, then each repository) and `prunable` to each worktree. It also inspects the main workspace, reported under `root: { checkouts: [...] }` (its root, then each primary clone) and never under `worktrees`, so consumers that iterate tasks are unchanged. Without `--status`, `list` reads only the task metadata and stays fast. `list --status` never fetches. Each checkout reports:

| Field        | Meaning                                                                                                                                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `branch`     | Current branch, `null` when detached.                                                                                                                                                                                                   |
| `dirty`      | `git status --porcelain` lists something: untracked files count, ignored files do not, and neither do unedited files Maestro wrote into the task root.                                                                                  |
| `localOnly`  | Commits no remote-tracking branch holds (`git rev-list HEAD --not --remotes`).                                                                                                                                                          |
| `upstream`   | `tracking`, `gone` (an upstream is configured but its remote branch was deleted), or `none`.                                                                                                                                            |
| `integrated` | The branch's work is in the reference branch: its tip is an ancestor of `origin/<reference>`, or the squash of `merge-base..tip` is patch-equivalent to a commit on it. The squash check catches branches merged by squash and deleted. |

`prunable` applies the `worktree prune` rule below without `--include-gone`. With `--forge github` (or `spec.execution.worktrees.forge: github`), the forge is also asked about checkouts whose upstream is gone, as described under [forge-backed integration](#forge-backed-integration).

The human output of `list --status` answers "which task do I open, and which ones can go": one row per task, the main workspace first as `@root`.

| Column      | Content                                                          |
| ----------- | ---------------------------------------------------------------- |
| Task        | task name                                                        |
| Repos       | repositories with a worktree, or `all`                           |
| Uncommitted | checkouts with `dirty: true`, comma-separated, or `-`            |
| Unlanded    | checkouts with `localOnly > 0` that are not `integrated`, or `-` |
| Prunable    | `yes` when `worktree prune` would remove the task, else `-`      |
| Age         | time since the task was created, such as `3d`                    |

`--detail` prints one row per checkout instead (branch, uncommitted changes, local-only commits, upstream, integration), as `list --status` did in 0.7.

Workspaces add their own columns with `spec.execution.worktrees.listColumns`:

```yaml
spec:
  execution:
    worktrees:
      listColumns:
        - name: PLATFORM
          command: ./scripts/platform-status # prints "task<TAB>up" for the running tasks
```

Each command runs once per `list --status`, with `sh -c` from the main workspace root, receiving the task names on stdin (one per line, `@root` first). It prints `task<TAB>value` lines; a task it does not mention shows `-`. The values land in the matching rows, and in the JSON under `worktrees[].columns` and `root.columns`. A command slower than 5 seconds is stopped: its column shows `?` and the report gets a `LIST_COLUMN_TIMEOUT` warning (`LIST_COLUMN_FAILED` for a non-zero exit).

A directory under `rootDir` without `.maestro/execution/worktree.json` was not created by `maestro worktree create`. `list` reports it under `foreign: [{ path, kind, source }]`, where `kind` is `git-worktree` (with `source`, the repository it belongs to), `git-repository`, or `directory`, and never as a task. `remove` and `prune` never touch it and report a `WORKTREE_FOREIGN` issue instead.

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
- `--forge github` (or `spec.execution.worktrees.forge: github`) asks the forge about the branches Git could not place; see [forge-backed integration](#forge-backed-integration). `--forge none` turns the manifest setting off for one run.
- `--task <name>` (repeatable) restricts `prune` to those tasks: only the workspace and their repositories are fetched, and the other tasks are neither inspected nor touched. With `--branches`, only the orphan branches of those task names (`<branchPrefix>/<name>/*`) are considered. A name with no task directory (and, with `--branches`, no task branch) fails the command with `WORKTREE_NOT_FOUND` before anything is fetched or removed. Use it to check or clean up one task, or to try a workspace's `preRemove` hooks on one task.
- `--dry-run` prints the plan, writing nothing but the fetched remote-tracking refs: the tasks it would remove, the branches it would delete, and the kept items.
- The primary clones' checked-out branches are never touched.

The `worktree-prune` report has the shape `{ removed: [...], deletedBranches: [{ name, branch }], kept: [{ name, reasons: [...] }], hooks, issues }`, where reasons read like `dirty: foods` or `2 local-only commits in platform-api`. `prune` only handles worktrees and branches; workspaces that own containers, databases, or proxy routes per task tear them down from a `preRemove` hook (below), which `prune` runs for each task it removes.

### Forge-backed integration

The patch comparison misses a squash merge once the reference branch changed the same lines afterwards: the branch's upstream is gone, its work is on the reference branch, but no single commit there is patch-equivalent to it. Asking the forge settles it.

```bash
maestro worktree list --status --forge github
maestro worktree prune --forge github
```

```yaml
spec:
  execution:
    worktrees:
      forge: github
```

- For each checkout (and, with `prune --branches`, each orphan branch) whose `upstream` is `gone`, that is not `integrated`, and that holds local-only commits, Maestro asks the forge for a merged pull request whose head was the upstream branch. With GitHub, it runs `gh pr list --repo <owner/repo> --head <branch> --state merged --json number,mergedAt`, using your own `gh` authentication; `owner/repo` comes from the repository's `origin` URL, and a remote that is not on GitHub is not looked up.
- A merged pull request makes the checkout `integrated: true` with `integratedBy: "forge"` and `pr: <number>`. Git checks set `integratedBy: "git"`. The `worktree-prune` report lists them under `mergedPullRequests: [{ item, checkout, pr }]`, and the human output reads `merged in #2028`.
- When `gh` is missing or unauthenticated, the report gets one `FORGE_UNAVAILABLE` warning and every verdict falls back to Git alone. It is never an error.
- Lookups run concurrently, bounded like the fetch. `list --status` still never fetches.

### `worktree path` and `worktree open`

```bash
maestro worktree path [<task>]                            # absolute task root on stdout
maestro worktree open [<task>] [--editor <id>] [--create] # opens the editor, then prints the root
cd "$(maestro worktree path fix-login)"
```

- `<task>` is a task name, or `@root` for the main workspace (the primary clones).
- Without a task, and when stdin and stderr are a terminal, a picker lists `@root` and every task with its repositories, uncommitted and unlanded checkouts, prunability, and age (the `list --status` rows): `fzf` when it is on `PATH`, otherwise a numbered menu on stderr. Without a terminal and without a task, the command fails with `TASK_REQUIRED`.
- stdout carries only the task root, so the commands compose with `cd` and shell functions. `open` writes its report (editor, launch command, and the `create` report with `--create`) to stderr, in human form unless `--format json` is passed.
- `open` on a missing task fails with `WORKTREE_NOT_FOUND`, unless `--create` creates it first with `worktree create` (`postCreate` hooks included).

The editor is `--editor`, else `$MAESTRO_EDITOR`, else `spec.execution.worktrees.editor`, else `vscode`:

| id                             | Launch (macOS / Linux)                                                                       | Target                     |
| ------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------- |
| `vscode`                       | `open -a "Visual Studio Code"` / `code`                                                      | task editor workspace file |
| `cursor`                       | `open -a Cursor` / `cursor`                                                                  | task editor workspace file |
| `devin`                        | `open -a Devin` / `devin-desktop`                                                            | task editor workspace file |
| `phpstorm`, `idea`, `webstorm` | the JetBrains CLI launcher when it is on `PATH`, else `open -na <App>`                       | task root                  |
| `none`                         | nothing                                                                                      | —                          |
| `custom`                       | `$MAESTRO_EDITOR_COMMAND`, with `{root}` and `{workspaceFile}` substituted, run with `sh -c` | —                          |

`worktree create` writes `<task>.code-workspace` in the task root, with the same generator as `maestro editor-workspace`, listing the workspace root and only the repositories the task has. Maestro records it like the task's other generated files, so it does not make the task dirty. A task created before 0.8 has no such file and opens on its root. An editor that cannot be launched fails with `EDITOR_UNAVAILABLE`, naming the launch command.

### `worktree hook`

Adapters for Claude Code's `WorktreeCreate` and `WorktreeRemove` command hooks. Claude Code replaces its own `git worktree` with these hooks for `claude --worktree <name>`, subagents with `isolation: worktree`, and background sessions. Wired to Maestro, every agent worktree becomes a task worktree, with the workspace's skills, `AGENTS.md`, and lifecycle hooks.

```bash
maestro worktree hook claude-create   # stdin {"name": ...}          → stdout: absolute task root
maestro worktree hook claude-remove   # stdin {"worktree_path": ...} → exit 0 removed, 1 kept
```

- `claude-create` sanitizes `name` like `--task` (and rejects a name with nothing left), resolves the main workspace from the current directory (so it works from inside a task root), runs `worktree create` with its `postCreate` hooks, and prints **only** the task root on stdout, as an absolute path with every symlink resolved, which Claude Code requires. The report and the hook output go to stderr. It exits non-zero when the creation fails, and Claude Code then aborts.
- `claude-remove` accepts only a path equal to `<rootDir>/<task>` of the resolved workspace and exits 1 for any other path. It runs `worktree remove` without `--force`: a task with uncommitted work stays, and the hook exits 1, which Claude Code reports.

Set `runtimes.claude-code.worktreeHooks: true` in the manifest and `workspace install` merges both hooks into `.claude/settings.json`, following the same "merge without owning the file" rule as plugin settings:

```json
{
  "hooks": {
    "WorktreeCreate": [
      {
        "hooks": [
          { "type": "command", "command": "maestro worktree hook claude-create", "timeout": 600 }
        ]
      }
    ],
    "WorktreeRemove": [
      {
        "hooks": [
          { "type": "command", "command": "maestro worktree hook claude-remove", "timeout": 600 }
        ]
      }
    ]
  }
}
```

The `timeout` is 600 seconds because `postCreate` may seed large dependency trees. Re-running install changes nothing, other keys and hooks stay untouched, and setting `worktreeHooks: false` removes exactly those two entries. The commands call `maestro` from `PATH`.

Claude Code keeps a subagent's worktree when a hook created it, even when the subagent changed nothing. `maestro worktree prune` collects those tasks like any other landed task.

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
