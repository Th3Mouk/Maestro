# Changelog

All notable changes to `@th3mouk/maestro` will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
