# Maestro — AI agent instructions

## Quality gates

Before committing, always run the full check suite:

```bash
pnpm check
```

This is the single source of truth and mirrors CI exactly. It runs (in order):
`sync:npm-shrinkwrap` → `knip` → `lint` → `format:check` → `typecheck` → `test:audit-prod` → `test:npm-shrinkwrap` → `build` → `test` → `test:runtime-dependencies` → `test:smoke` → `test:pack`

**Do not** substitute `pnpm lint && pnpm typecheck` — `knip` and `format:check` are not included and will fail in CI.

To fix formatting automatically before the check:

```bash
pnpm format   # auto-fix, then re-run pnpm check
```
