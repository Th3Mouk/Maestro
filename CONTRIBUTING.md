# Contributing

## Local workflow

Install dependencies and use the repository validation path before opening a pull request:

```bash
pnpm install
pnpm knip
pnpm lint
pnpm format:check
pnpm check
pnpm build
```

`Knip` checks for unused files, exports, dependencies, and unlisted binaries.
`Oxlint` is the repository linter and `Oxfmt` is the repository formatter.
TypeScript semantic checks still run through `tsc`.

Use `pnpm check` to run the full delivery validation path:

- `pnpm knip`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm test`
- `pnpm build`
- `pnpm test:smoke`
- `pnpm test:pack`

Use `pnpm lint:fix` or `pnpm format` to normalize local changes before review.

## Working on the repository

Create a private local workspace inside this repository without turning it into part of the published project:

```bash
maestro init .local/workspaces/my-codex-lab
```

Dry-run an existing example:

```bash
maestro install --workspace ./examples/ops-workspace --dry-run
```

Prepare an isolated task worktree:

```bash
maestro worktree --workspace ./examples/ops-workspace --task release-prep
```

Check the workspace files and generated artifacts:

```bash
maestro doctor --workspace ./examples/ops-workspace
```

## Pull requests

- Add or update tests for every behavior change
- Open pull requests only after the branch passes the same `pnpm check` run in GitHub Actions

## Rules

- Preserve the separation between core, adapters, validation, and plugins
- Keep examples executable and aligned with the documentation
- Cover every new policy, runtime projection, or plugin extension with tests
- Do not introduce external service dependencies into tests
- Keep documentation and harness rules in English and aligned with the shipped behavior
