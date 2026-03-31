# CLI install

Maestro publishes a `maestro` command. Install it with the package manager that best matches your workflow, then start with `maestro init`.

Prerequisites:

- Node.js `>= 20`
- `git` available on `PATH`

## Choose an install path

| Path                 | Command                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------- |
| npm global           | `npm install -g @th3mouk/maestro`                                                                       |
| pnpm global          | `pnpm add -g @th3mouk/maestro`                                                                          |
| npx, no install      | `npx @th3mouk/maestro@latest init my-workspace`                                                         |
| pnpm dlx, no install | `pnpm dlx @th3mouk/maestro@latest init my-workspace`                                                    |
| Homebrew on macOS    | `brew tap th3mouk/maestro https://github.com/Th3Mouk/maestro`<br>`brew install th3mouk/maestro/maestro` |

The Homebrew core namespace already has an unrelated `maestro` cask, so use the tap-qualified formula name to avoid ambiguity with the unrelated cask.

For npm publication, the release workflow uses GitHub Actions OIDC trusted publishing. npm requires the package to exist before you can attach a trusted publisher, so the very first publish still needs a one-time bootstrap before the OIDC trust relationship can be enabled.

## First run

```bash
maestro --help
maestro init my-workspace
cd my-workspace
maestro install --workspace . --dry-run
maestro install --workspace .
maestro bootstrap --workspace .
maestro doctor --workspace .
```

If you want a step-by-step first-run flow with expected generated files, see [5-minute quickstart](./quickstart.md).

`maestro install` initializes the workspace root as a Git repository when needed, creates a `🪄 booted by Maestro` commit when the repository is unborn, then clones repositories and projects workspace/runtime artifacts.
It does not run repository dependency installation by itself.
If the workspace was booted without a prior `maestro init`, Maestro writes the default `.gitignore` before creating that first commit. If the file already exists, Maestro keeps the existing entries and appends the missing defaults.

When you define repositories in `maestro.yaml`, omitting `spec.repositories[].sparse` keeps the checkout complete. Add `includePaths`, `excludePaths`, or both when you want Maestro to materialize only part of the repository.

Use `maestro bootstrap` after `install` when you want Maestro to install repository dependencies.
Auto mode already detects `composer`, `uv`, `npm`, `pnpm`, `yarn`, and `bun` from the materialized repositories.

## Troubleshooting

| Problem                                                     | What to check                                                                                                                                                                                              |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maestro: command not found` after a global install         | Open a new shell, confirm your global package-manager bin directory is on `PATH`, or use `npx @th3mouk/maestro@latest init my-workspace` / `pnpm dlx @th3mouk/maestro@latest init my-workspace` to verify the package works. |
| Homebrew install is ambiguous                               | Use the tap-qualified path: `brew tap th3mouk/maestro https://github.com/Th3Mouk/maestro` then `brew install th3mouk/maestro/maestro`.                                                                     |
| You only want to evaluate the CLI once                      | Prefer `npx @th3mouk/maestro@latest init my-workspace` or `pnpm dlx @th3mouk/maestro@latest init my-workspace` instead of a global install.                                                             |
| You want the Maestro CLI map for agents                     | Open the generated `AGENTS.md` in the workspace root. It explains `init`, `install`, `bootstrap`, `sync`, `update`, `doctor`, `git checkout`, `git pull`, `git sync`, and `worktree`.                      |
| `maestro init` succeeded but you are not sure what happened | Run `cd my-workspace && maestro install --workspace . --dry-run` and compare the generated files with [5-minute quickstart](./quickstart.md).                                                              |
| You are working on the repository itself                    | Use the source workflow below, not the published package flow above.                                                                                                                                       |

## If you are developing the package

```bash
pnpm install
pnpm knip
pnpm lint
pnpm format:check
pnpm check
pnpm build
```

`Knip` provides the repository graph-hygiene gate for unused files, exports, dependencies, and binaries.
`Oxlint` provides the repository lint gate and `Oxfmt` provides the repository formatting gate.
TypeScript semantic validation still runs through `pnpm typecheck`.

Those commands are for working on Maestro itself. They are not required for users who install the published package.
