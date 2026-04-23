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
- Internal refactor: bootstrap plan, devcontainer rendering, and workspace overlay logic modularized.
- Internal refactor: prototype exploded to follow SRP, SOLID, and clean-code conventions.

### Fixed

- `install`, `sync`, and `update` now exit with a non-zero status code when the report status is `error`.

## [0.1.5] - earlier

Releases prior to this changelog are not itemized here. See the git history and GitHub releases for details.
