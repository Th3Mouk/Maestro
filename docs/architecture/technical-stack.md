# Technical Stack

This document is the source of truth for Maestro's implemented stack and architecture constraints.

It complements [`overview.md`](./overview.md) with runtime, tooling, dependency roles, and guardrails.

## Runtime baseline

- Node.js `>=20`
- TypeScript for shipped source
- pnpm for development and release validation

## Validation baseline

- `knip` for unused files, exports, dependencies, and binaries
- `oxlint` for linting
- `oxfmt` for formatting
- `tsc` for semantic type checks
- `vitest` for unit and integration tests
- `@vitest/coverage-v8` for deterministic Node-native coverage reporting
- `pnpm test:smoke` for packed CLI smoke validation
- `pnpm test:pack` for tarball verification

Coverage policy:

- coverage is configured with provider `v8` in `vitest.config.ts`;
- default `pnpm test` does not collect coverage;
- `pnpm test:coverage` is the coverage validation path;
- `pnpm test:coverage:ci` is the CI alias to enforce the same thresholds in pipeline runs;
- global thresholds enforced on coverage runs are:
  - statements: `50`
  - lines: `50`
  - functions: `50`
  - branches: `35`

## Dependency roles

Current runtime dependencies:

- `commander`: CLI command declaration
- `deepmerge`: maintained deep merge primitive for workspace manifest/fragment spec composition
- `execa`: child-process execution
- `picomatch`: glob policy matching
- `proper-lockfile`: lock discipline for shared workspace artifacts
- `safe-regex2`: regex safety validation for user-provided patterns
- `semver`: version handling
- `shell-quote`: shell-safe argument composition
- `yaml`: manifest parsing
- `zod`: runtime schema validation and type derivation

Validation tool roles:

- `knip`: repository graph hygiene across source, tests, scripts, and example pack scripts
- `oxlint`: syntax and import hygiene
- `tsc`: semantic type checking
- `vitest`: test execution and coverage enforcement
- `oxfmt`: repository formatting

Dependency governance rule: do not add or retain a non-trivial dependency without recording:

1. the problem it solves;
2. the local code it replaces or prevents;
3. the validation impact;
4. the public-doc impact, if any.

Dependency simplification decisions (Review section 3 closure):

- `p-map` replacing `mapWithConcurrency`: deferred; fix current worker short-circuit behavior locally first, then re-evaluate only if concurrency needs grow.
- `git-url-parse` replacing `parseGitHubRemote`: deferred; keep local parser and patch local edge cases before adding a new runtime dependency.
- `defu` replacing `deepmerge`: rejected for now; `deepmerge` remains the approved merge primitive because current merge semantics and tests already depend on it.
- `fast-json-stable-stringify` replacing `stableStringify`: deferred; keep local deterministic stringify unless concrete edge-case failures appear.
- Campaigns-related directions previously removed from product scope are not valid dependency drivers and must not be reintroduced through stack changes.

## Architecture rules

### Security and safety

- Dynamic Git arguments must enforce explicit option boundaries.
- Git working-tree cleanliness gates use `git status --porcelain --untracked-files=no` by policy, so tracked changes block operations while untracked local scratch files do not.
- Shell command composition must use approved escaping primitives.
- Relative paths derived from manifest or CLI input must stay workspace-bounded.
- User-provided matching rules must avoid unbounded regex behavior.

### Module boundaries

- Keep orchestration, adapters, validation, workspace parsing, and filesystem safety in distinct modules.
- Workspace loading/merge concerns should stay in `src/workspace/manifest-parser.ts`; pack and discovery logic should stay in `src/workspace/pack-resolver.ts` and `src/workspace/agent-discovery.ts`.
- Avoid catch-all files that mix unrelated responsibilities.
- Prefer injected command context/services over global singletons.
- Keep domain types near their owning modules unless a shared boundary requires centralization.

### Schema ownership

- Zod schemas are the runtime source of truth for validated configuration.
- Prefer `z.infer` derivation over parallel interface maintenance.
- Avoid unchecked casts where a schema already exists.

### Concurrency and state

- Shared workspace artifacts require explicit lock discipline.
- Performance work must preserve lock and policy semantics.
- Async flows should avoid synchronous filesystem hotspots in hot paths.
- Repository-parallel operations must use bounded concurrency (default limit currently `4`) and preserve deterministic result ordering.
- Bounded concurrency is for independent repository-local actions; shared workspace state still requires `withWorkspaceLock`.

### Testing

- CLI integration behavior should be tested at the child-process boundary where practical.
- Use `vi.stubEnv` and per-test lifecycle hooks (`onTestFinished`) rather than ad hoc global cleanup.
- Avoid long-lived mutation of shared process globals when an injectable I/O boundary exists.
- Security-sensitive changes require hostile-input coverage, not only happy-path tests.
- Workspace merge semantics coverage is maintained in `tests/unit/workspace-service.test.ts`:
  - deterministic merge of includes and fragments;
  - workspace-bounded include path rejection.

## Real remaining backlog

- reduce non-shared type concentration in `src/types.ts`;
- complete workspace path-bounding coverage across all dynamic path composition sites;
- coverage reporting is enabled through `pnpm test:coverage` and enforced with explicit thresholds;
- evaluate and document the long-term lifecycle for compatibility facades such as `src/core/commands.ts`.

## Required documentation updates when this stack changes

Any stack-affecting delivery must review and update the relevant subset of:

- [`docs/architecture/overview.md`](./overview.md)
- [`docs/cli/commands.md`](../cli/commands.md)
- [`docs/manifests/workspace.md`](../manifests/workspace.md)
- [`README.md`](../../README.md)
- [`docs/project-language/release-framing.md`](../project-language/release-framing.md)
- [`docs/project-language/repository-framing.md`](../project-language/repository-framing.md)
