# Changelog

All notable changes to `@th3mouk/maestro` will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
