# Changelog

All notable changes to `@th3mouk/maestro` will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0]

Claude Code's `WorktreeCreate`/`WorktreeRemove` hooks and workspace navigators now route every agent and human worktree through `maestro worktree`, so its safety and its cost apply to every session and subagent. This release makes `remove` and `create` unable to lose work, lets a task check out only the repositories it touches, bases new task branches on fresh default refs, and adds `list --status` and `prune` to clean up the tasks whose work has landed.

### Added

- `maestro worktree create --repos <a,b>` checks out only the listed repositories instead of every managed repository, which saves disk, IDE indexing, and dependency seeding for tasks that touch one or two repositories. Repositories that are not selected are absent from `<taskRoot>/repos/`; Maestro never links them to the primary clone. Running `create --repos` again on an existing task adds the missing repositories and leaves the others untouched. An unknown name fails the command with `REPO_UNKNOWN` before anything is created.
- `.maestro/execution/worktree.json` records `repositories`, the repositories that have a worktree in the task. `worktree remove` iterates over that list instead of the manifest, the task's `maestro.json` descriptor lists only those repositories, and `worktree list` reports them per task. Metadata written by earlier versions, without the field, falls back to the directories present under `<taskRoot>/repos/`.
- `maestro worktree create --offline` skips the fetch described below and bases new task branches on the local reference branches.
- `maestro worktree list --status` inspects every checkout of each task (workspace root first, then each repository) and reports `checkouts: [{ name, path, branch, dirty, localOnly, upstream, integrated }]` plus a derived `prunable`. `integrated` is true when the branch tip is an ancestor of `origin/<reference>`, or when the squash of `merge-base..tip` is patch-equivalent to a commit on it, which catches branches squash-merged with `delete_branch_on_merge`. Without `--status`, `list` stays as fast as before.
- `maestro worktree prune [--dry-run] [--include-gone] [--branches] [--no-fetch]` removes every task whose checkouts are all clean and hold no local-only work that is not integrated, through the same path as `remove`, then deletes its task branches with `git branch -D`. It runs `git fetch --prune` on the workspace and each repository first, unless `--no-fetch`. `--include-gone` also prunes clean branches whose upstream was deleted (off by default: a deleted remote branch is not proof the work landed). `--branches` also deletes orphan task branches (`<branchPrefix>/*/*` with no worktree) under the same rule and lists the ones it keeps. `--dry-run` prints the plan. The `worktree-prune` report lists `removed`, `deletedBranches`, and `kept` items, each with its reasons (`dirty: foods`, `2 local-only commits in platform-api`, …). Workspaces can drive their own teardown (containers, databases, routes) from `prune --dry-run --json` before calling `remove`.

### Changed

- The workspace-root task branch now starts from the workspace's default branch: `origin/HEAD`'s target when it resolves, else `main`. It used to start from `HEAD`, so a task created while the root checkout sat on a feature branch inherited that branch's commits.
- New repository task branches now start from a fresh `origin/<branch>` instead of the local reference branch, which is often behind. `worktree create` fetches the reference branch of each repository that needs a new task branch (`git fetch origin <branch>`, with the usual repository concurrency), then branches from `origin/<branch>` when it exists. A failed fetch is a `FETCH_FAILED` warning, and the local reference branch is used. Reused task branches and existing worktrees are never moved or fetched for, and the primary clones' checked-out branches are not touched.

### Fixed

- `maestro worktree remove` no longer deletes uncommitted work. It used to delete the task root even when `git worktree remove` refused a dirty checkout, losing its uncommitted and untracked files and leaving a `prunable` entry in the source repository. It now checks every checkout of the task (workspace root and each repository) first: if any holds uncommitted changes or untracked files, nothing is removed and the report fails with one `WORKTREE_DIRTY` issue per dirty checkout (`path`, `changedFiles`). Ignored files such as `vendor/` or `node_modules/` do not count, and neither do the files Maestro itself wrote into the task root (the workspace descriptor and the overlay copies) as long as they are unedited. The task root is deleted only once every `git worktree remove` succeeded, or under `--force`, which still discards the changes.
- `maestro worktree create` no longer resets an existing task branch. It ran `git worktree add -B`, so `remove` followed by `create --task <same name>` silently moved `<branchPrefix>/<task>/<repo>` back to the base ref, and the task's commits survived only in the reflog. An existing task branch is now checked out as is and reported with the new `reused` status; a missing one is created from the base ref with `git worktree add -b`. The same rule applies to the workspace-root worktree.
- `maestro worktree create`, `remove`, and `list` no longer treat a task root as a workspace when run from inside it. `--workspace` defaults to the current directory, so running `maestro worktree create` from `<rootDir>/<task>/` nested new worktrees under the task. When the workspace root carries `.maestro/execution/worktree.json`, Maestro now resolves the main workspace through `git rev-parse --git-common-dir`, operates on it, and adds a `WORKSPACE_RESOLVED_FROM_TASK` issue with both paths. When the main workspace cannot be resolved, the command fails with `WORKSPACE_IS_TASK_WORKTREE` and writes nothing.

## [0.6.0]

Claude Code 2.1.277 reads `AGENTS.md`, which leaves skills, subagents, and workflows as the only places where coding agents still disagree on files. This release makes Maestro project only those, stop owning instruction files and tool configuration, and cover every runtime whose subagent format is documented.

### Added

- Agent projection for seven more runtimes: `codex` (`.codex/agents/<name>.toml`), `cursor` (`.cursor/agents/`), `copilot` (`.github/agents/<name>.agent.md`), `gemini` (`.gemini/agents/`), `opencode` (`.opencode/agents/`), `kilo` (`.kilo/agents/`), and `devin` (`.devin/agents/`), alongside `standard` and `claude-code`. Agents are authored per runtime under `agents/<runtime>/` and copied unchanged; Maestro does not convert between formats. `spec.runtimes`, `spec.agents`, pack `provides.agents`, and `maestro init --runtimes` accept the new keys.
- Workflow projection for Claude Code: `workflows/<name>.js` (plus `overrides/workflows/` and pack `workflows/`) is written as real files into `.claude/workflows/`. Select them with the new `spec.workflows` (same shapes as `spec.skills`), ship them from packs with `provides.workflows`, and resolve pack collisions with `spec.conflicts.workflows`.
- Per-asset projection options under each runtime: `skills`, `agents`, and `workflows` each accept `true`, `false`, or `{ mode: merge | replace }`, and override the runtime-wide `projectionMode`. `claude-code` skills also accept `strategy: symlink | copy`.
- Canonical layout when `spec.runtimes` is omitted: skills in `.agents/skills/` and `.claude/skills/`, workflows in `.claude/workflows/`, no agents. Runtimes from pack fragments are merged on top of it.
- `.claude/skills/<name>` is now a symlink to `.agents/skills/<name>` when the `standard` runtime also projects skills, so both runtimes read one tree. Maestro copies instead on Windows, when `standard` skills are off, or with `strategy: copy`. Task worktrees keep these links relative.
- `maestro workspace doctor` reports `LEGACY_GENERATED_CLAUDE_MD` when `CLAUDE.md` still carries the banner written by Maestro 0.5 or earlier, because that file hides `AGENTS.md` from Claude Code.
- Copilot's `<name>.agent.md` naming is recognized in `agents/<runtime>/` and `overrides/agents/<runtime>/`.

### Changed

- **BREAKING**: Maestro no longer creates `CLAUDE.md`, in any case. The `claude-code` runtime stopped writing it, and pack or override `templates/CLAUDE.md` files are no longer applied. Keeping a `CLAUDE.md`, and versioning it, is now the team's decision; Claude Code reads `AGENTS.md` directly when no `CLAUDE.md` exists. An existing generated `CLAUDE.md` is left in place: delete it, or replace its content with `@AGENTS.md`. See [AGENTS.md in Claude Code](https://code.claude.com/docs/en/memory#agents-md) for the consequences of each option.
- **BREAKING**: Omitting `spec.runtimes` now applies the canonical layout instead of projecting nothing. Set `runtimes: {}` to keep projecting nothing.
- **BREAKING**: Agent projection is off until a runtime defines `agents`. A 0.5 workspace that relied on `standard` or `claude-code` projecting `.agents/agents/` or `.claude/agents/` must add `agents: {}` under that runtime.
- **BREAKING**: `.gitignore` entries now cover only the directories of active projections (for example `.agents/skills/`, `.claude/skills/`, `.claude/workflows/`, `.codex/agents/`). New workspaces no longer ignore the whole `.claude/` directory or `.mcp.json`, so `.claude/settings.json`, hooks, and MCP configuration can be versioned. Existing entries are never removed; drop `.claude/` and `.mcp.json` from your `.gitignore` by hand if you want to version those files.
- `.claude/settings.json` is only touched when `spec.plugins["claude-code"]` sets `enabled` or `marketplaces`. Maestro then merges `enabledPlugins` and `extraKnownMarketplaces` into the existing file and keeps every other key; it drops the `generated` and `workspace` markers written by earlier versions.
- The `claude-code` runtime no longer creates an empty `.claude/commands/` directory; Claude Code has merged commands into skills.
- A selected agent that no file defines is now written as a valid placeholder for its runtime (TOML with `developer_instructions` for Codex, Markdown with `name` and `description` frontmatter elsewhere).
- Task worktrees now carry `.agents/` and every runtime agent directory over from the workspace root, instead of only `.claude/`, `.codex/`, and `.opencode/`.

### Removed

- **BREAKING**: `spec.mcpServers` and the `.mcp.json` projection. Maestro no longer manages MCP servers or tool hooks; configure them in each tool's own files. The key is ignored if still present, and an existing `.mcp.json` is left untouched.
- **BREAKING**: `spec.runtimes.<runtime>.installProjectInstructions` and `spec.runtimes.<runtime>.instructionsFile`, with no replacement. They had no effect; the keys are ignored if still present.
- `fragments/mcpServers.yaml` is no longer auto-included as a default fragment.

See [docs/manifests/workspace.md](docs/manifests/workspace.md#runtime-projection) for the canonical layout, every projection option, and the subagent format of each runtime.

## [0.5.0]

### Added

- New `spec.runtimes.<runtime>.projectionMode` config (`merge` | `replace`) lets you choose how `standard` and `claude-code` runtime projection treats content that's already in `.agents/agents/`, `.agents/skills/`, `.claude/agents/`, and `.claude/skills/`. `merge` (the default) touches only the exact agent/skill names about to be (re)projected — it overwrites those and leaves everything else in the directory alone, so hand-placed or third-party agents and skills can cohabit the directory with Maestro's own. `replace` deletes each target directory outright before projecting, so Maestro fully owns it and nothing foreign or stale survives.
- `spec.agents.<runtime>` and `spec.skills` now also accept `{ exclude: [...] }` in place of a plain name list, selecting every discovered workspace agent/skill (plus anything packs provide) except the ones listed — useful for "everything but a few" instead of enumerating every name you want.

### Changed

- **BREAKING**: `claude-code` and `standard` skills projection no longer unconditionally wipes `.claude/skills/` / `.agents/skills/` on every `workspace install`/`update`. It now follows `projectionMode`, which defaults to `merge`: only the skill names in `spec.skills` (and matching agent names in `spec.agents`) are touched, so anything else already in those directories — including a skill you previously removed from `spec.skills` — is left in place. Set `projectionMode: replace` on a runtime to restore the previous "Maestro owns this directory outright" behavior. Agent projection is unchanged by default; it already behaved like `merge`.
- **BREAKING**: Omitting `spec.agents.<runtime>` or `spec.skills` now selects every agent/skill Maestro can discover for that runtime — workspace-local files under `agents/<runtime>/` or `skills/`, plus anything packs provide — instead of selecting none. A workspace that left these fields unset while keeping unreferenced agent/skill files on disk will start projecting those files on the next `workspace install`/`update`. To keep selecting nothing, set the field to an explicit empty list (`skills: []`); to keep today's exact selection, list the names you currently rely on.

See [docs/manifests/workspace.md](docs/manifests/workspace.md#projection-mode-merge-or-replace) for the full picture.
See [docs/manifests/workspace.md](docs/manifests/workspace.md#selecting-agents-and-skills) for how default-all and `exclude` selection work.

## [0.4.0]

### Added

- `claude-code` runtime projection now also materializes every selected skill into `.claude/skills/<name>/SKILL.md`, matching the agent projection it already performs into `.claude/agents/`. Previously, enabling `claude-code` projected agents but silently skipped skills.
- `maestro doctor` now also validates that `.claude/skills/` and `.agents/skills/` exist when the corresponding runtime is enabled.

### Changed

- **BREAKING**: Runtime projection is now organized around exactly two targets instead of one-per-tool. `spec.runtimes`, `spec.agents`, and pack `provides.agents` now accept only `standard` and `claude-code` — the `codex` and `opencode` keys are gone. `claude-code` is unchanged (`.claude/agents/`, `.claude/skills/`, `.claude/commands/`, `CLAUDE.md`, `.claude/settings.json`, `.mcp.json`). `standard` replaces both `codex` and `opencode`, projecting every selected skill into `.agents/skills/<name>/SKILL.md` and every selected agent into `.agents/agents/<name>.md` — the shared directory convention that Cursor, Codex, Devin, Kilo Code, OpenCode, and other Agent Skills-compatible tools scan directly, with no per-tool config indirection to point at instead. `maestro init --runtimes` now accepts `standard,claude-code` (the new default) in place of `codex,claude-code,opencode`.
- **BREAKING**: Codex-native projection (`.codex/config.toml`, `.codex/agents/*.toml`) and OpenCode-native projection (`.opencode/opencode.json`, `.opencode/agents/*.md`) are removed. Neither format has a shared, multi-tool equivalent under `.agents/`, so it was retired rather than duplicated per tool. Project-scoped MCP servers (`spec.mcpServers`) now project only into `.mcp.json` for Claude Code — the Codex-config MCP and plugin blocks (`spec.plugins.codex`, also removed from the schema) no longer have anywhere to project to. Workspaces that relied on `.codex/config.toml` or `.opencode/opencode.json` being generated will stop seeing those files; migrate any tooling that reads them to `.agents/skills/` and `.agents/agents/`, or to `.mcp.json` for MCP server config.

See [docs/manifests/workspace.md](docs/manifests/workspace.md#two-runtimes-standard-and-claude-code) for the full picture and the rationale.

## [0.3.0]

### Changed

- `repo git pull` now tolerates a dirty working tree. Uncommitted tracked changes are auto-stashed before the fast-forward and restored afterwards, so you can refresh the current branch without committing or stashing first. The command still refuses to run in detached HEAD state and now also refuses when a merge or rebase is in progress.
- `repo git pull` aborts and reports a failure when restoring the auto-stash would conflict with upstream changes. `HEAD` is reset to its pre-pull commit and local changes are preserved in `git stash list` so nothing is lost; run `git stash pop` manually after reconciling.
- **BREAKING**: `repo bootstrap` JSON now reports `repositories[].state` (`"executed" | "skipped" | "failed"`) instead of `repositories[].skipped` (boolean). Scripts reading `.data.repositories[].skipped` must switch to `.data.repositories[].state === "skipped"`.

### Fixed

- `repo bootstrap` no longer reports a repository as `executed` when its bootstrap command actually failed. Both the JSON report and the human table now show `failed` for that repository, matching the corresponding `BOOTSTRAP_COMMAND_FAILED` entry in `issues`. The report `status` still resolves to `warning` rather than `error` for a per-repository command failure, and the process still exits `0`, consistent with the exit code convention documented under [Scripting](docs/cli/commands.md#scripting) — script against `repositories[].state` (or `issues`), not the exit code, to detect a failed repository.

### Fixed

- `worktree create` no longer generates `maestro.code-workspace` inside the new task worktree. That file is documented as an optional, on-demand editor artifact generated only by `maestro editor-workspace`; task worktrees now follow the same contract already enforced for `init` and `workspace install`.

## [0.2.0]

### Added

- `worktree remove` command (with `--force`) and `worktree list` command.
- `repo list` command.
- Codecov integration with coverage reporting in CI.
- Push trigger on the `main` branch in CI.
- `--format <human|json>` global flag on all report-emitting commands.
- `--json` shorthand for `--format json`.
- `--no-color` flag (also honors `NO_COLOR` and `FORCE_COLOR` env vars).
- `MAESTRO_FORMAT` env var to override the default format.
- Human-readable output: tables for list-style reports, grouped issue lists for `workspace doctor`, status-colored summaries.
- Stable JSON envelope `{data, schemaVersion: 1}` on stdout and `{error: {code, message, details?}, schemaVersion: 1}` on stderr for machine-readable consumers.
- Error code taxonomy: `WORKSPACE_NOT_FOUND`, `REPO_MISSING`, `WORKTREE_NOT_FOUND`, `WORKTREE_METADATA_MISSING`, `GIT_OPERATION_FAILED`, `MANIFEST_INVALID`, `BOOTSTRAP_FAILED`, `PERMISSION_DENIED`, `WORKSPACE_LOCKED`, `REPO_DIRTY`, `UNEXPECTED`.

### Changed

- **BREAKING**: CLI surface reorganized from flat commands into grouped verbs:
  - `install` → `workspace install`
  - `update` → `workspace update`
  - `sync` → `workspace prune` (renamed)
  - `doctor` → `workspace doctor`
  - `bootstrap` → `repo bootstrap`
  - `git-checkout` → `repo git checkout`
  - `git-pull` → `repo git pull`
  - `git-sync` → `repo git sync`
  - `worktree <task>` → `worktree create --task <task>`
  - `code-workspace` → `editor-workspace`
  - `upgrade` → `self upgrade`
- **BREAKING**: Default output format is now human-readable tables on an interactive terminal. JSON output remains the default when stdout is piped/redirected. Scripts that expect JSON on a TTY should pass `--format json`, `--json`, or set `MAESTRO_FORMAT=json`.
- **BREAKING**: JSON output is now wrapped in an envelope (`{data, schemaVersion: 1}`). Scripts parsing the old unwrapped report must read `.data`.
- `repo git checkout|pull|sync` exit codes normalized: status `warning` now exits 0 (was 1) to match all other commands. Exit code 1 is now reserved for `status === "error"` across the whole CLI.
- Internal refactor: bootstrap plan, devcontainer rendering, and workspace overlay logic modularized.
- Internal refactor: prototype exploded to follow SRP, SOLID, and clean-code conventions.

### Fixed

- `install`, `sync`, and `update` now exit with a non-zero status code when the report status is `error`.

## [0.1.5] - earlier

Releases prior to this changelog are not itemized here. See the git history and GitHub releases for details.
