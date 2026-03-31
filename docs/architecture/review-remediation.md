# Review Remediation Workflow

This document is the standard workflow for processing technical reviews and audits.

## Current cycle snapshot

- Source of truth for item status: [`REVIEW.md`](../../REVIEW.md).
- `pnpm check` now includes `knip`, and CI runs the same hygiene gate alongside lint, format, type, and test validation.
- Knip covers unused files, exports, dependencies, and binaries; intentional entrypoints and public exports now need explicit coverage in `knip.json`.
- Current CLI path is wired directly to command modules in `src/core/commands/*` via `src/cli/main.ts`.
- `src/core/commands.ts` is retained as a compatibility API layer for direct imports/root exports and is intentionally outside the CLI execution path.
- Workspace loading concerns are split into dedicated modules:
  - `src/workspace/manifest-parser.ts`
  - `src/workspace/pack-resolver.ts`
  - `src/workspace/agent-discovery.ts`
- Merge semantics and include-path safety are covered in `tests/unit/workspace-service.test.ts` (deterministic includes/fragments merge and workspace-bounded include rejection).
- Compatibility policy for `src/core/commands.ts`:
  - keep the façade in the current product line;
  - do not remove it through routine refactors;
  - if removal is ever planned, do it only in a dedicated breaking-change window with explicit deprecation notice and migration guidance.

## Objective

Turn every review into a closed, verifiable delivery loop with clear ownership, bounded execution, and durable documentation updates.

## Inputs

- `REVIEW.md`: active findings and remediation backlog
- stack governance docs:
  - [`technical-stack.md`](./technical-stack.md)
  - [`overview.md`](./overview.md)
- validation baseline:
  - Knip, lint, format, typecheck, build, tests, smoke/pack checks

## Standard loop

1. Triage findings
   - remove stale/incorrect findings
   - split remaining work into bounded, non-overlapping scopes
2. Delegate by scope
   - assign each scope to a dedicated execution owner (or sub-agent)
   - keep write scopes disjoint
3. Implement and validate per scope
   - apply code changes
   - run focused validation for touched surfaces
4. Integrate and run full gate
   - run full validation (`pnpm check`)
   - fix regressions introduced by integration
5. Update durable docs
   - update `REVIEW.md` status
   - update architecture/stack docs when guarantees changed
   - explicitly document compatibility layers that are intentionally retained
6. Close cycle
   - `REVIEW.md` must contain no open items for the cycle
   - retain only future drift signals and process guidance

## Mandatory acceptance criteria

- every merged remediation item is backed by passing validation;
- no stale findings remain in `REVIEW.md`;
- stack-affecting changes are reflected in docs;
- no unresolved blocking regressions remain after full-gate validation.

## Default validation gate

- `pnpm knip`
- `pnpm lint`
- `pnpm format:check`
- `pnpm typecheck`
- `pnpm build`
- `pnpm test`
- `pnpm test:smoke`
- `pnpm test:pack`

## Coverage policy

- coverage is enforced through `pnpm test:coverage` (`vitest --coverage`, provider `v8`);
- CI coverage entrypoint is `pnpm test:coverage:ci`;
- thresholds are maintained in `vitest.config.ts` and reviewed when risk profile changes.

## Drift signals to watch

- dependency added without stack rationale;
- security-sensitive primitive reimplemented locally;
- catch-all module regrowth across unrelated concerns;
- path-bounding bypass on dynamic inputs;
- new standalone script, entrypoint, or binary added without Knip coverage;
- docs no longer match shipped behavior.
