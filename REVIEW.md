# Maestro Review Status (Current Cycle)

This file tracks factual remediation status for the current release cycle.
It is intentionally short and only lists actionable open items.

## Completed in this cycle

- `mapWithConcurrency` now short-circuits scheduling on first mapper failure while preserving index-stable output ordering.
- `parseGitHubRemote` now handles trailing slashes and common SSH/HTTPS URL forms without overmatching.
- CLI unhandled error rendering now hides stacks by default and only prints stack traces when explicit verbose env flags are enabled (`MAESTRO_VERBOSE` or `MAESTRO_VERBOSE_ERRORS`).
- `GitAdapter.isClean` behavior (`--untracked-files=no`) is now explicitly documented in user-facing CLI docs and architecture guardrails.
- Dependency simplification recommendations from the review were converted into explicit decisions:
  - `defu` replacing `deepmerge`: rejected for now;
  - `p-map`, `git-url-parse`, `fast-json-stable-stringify`: deferred with rationale in stack governance docs.
- Full validation gate passes after remediation (`pnpm -s check`).

## Open items

### Test Suite Improvements & Actionable Items

- Completed:
  - resource leak remediation applied in test suites by replacing test-local temp directories with `createManagedTempDir(...)`;
  - mock lifecycle normalized with `clearMocks: true` in `vitest.config.ts` and reset boilerplate removed from targeted files;
  - unsafe `as never` mock typing removed from targeted unit tests via typed fixtures/builders;
  - YAML helper added as `tests/utils/yaml.ts` and adopted in `tests/unit/workspace-resolution.test.ts`;
  - `git-adapter.test.ts` reclassified to integration (`tests/integration/git-adapter.test.ts`) and adapter instantiation isolated per test via `beforeEach`;
  - timer-based tests in `fs-performance` and `execution-service` now use fake timers for deterministic execution.
- Remaining:
  - optional follow-up: migrate large inline YAML fixtures in `tests/integration/workflow.test.ts` to `writeYaml(...)` for full consistency.

### Deep Technical Review (Security, Dead Code, & Simplifications)

- Completed:
  - `devcontainer.baseImage` is now strictly validated in schema to block newline/injection payloads.
  - task branch name creation now sanitizes `taskName` defensively inside `createTaskBranchName(...)`.
  - pack source boundary checks are now consistent for absolute and relative sources.
  - PR generation is resilient to per-repository adapter failures (issues are recorded and processing continues).
  - `DiffSizeLimitPolicy` now rejects invalid numeric thresholds explicitly (`DIFF_LIMIT_INVALID_NUMBER`).
  - execution defaults are schema-owned, and manual `normalizeExecution` logic has been removed from workspace resolution.
  - dead `SchemaAdapter` type surface was removed.
  - official `@types/proper-lockfile` has replaced the manual shim declaration.
  - agent discovery file resolution now uses deterministic extension probing (`.toml`, `.md`, `.json`) rather than broad filename-prefix scanning.
- Remaining:
  - remove `getRepositoryReferenceBranch(...)` and inline `repository.branch` directly across call sites (schema already defaults the branch).
  - compatibility follow-up: `pr-report.json` now stores `{ results, issues }`; any external consumer expecting a raw array should be migrated.

## Guardrails for closing the cycle

- Do not mark an item done without command output proving validation.
- Keep this file aligned with `docs/architecture/review-remediation.md`.
- Remove completed items from this file as they are validated and merged.

## Proposed Architectural & DX Improvements (Next Cycle)

As the project scales from a robust MVP to a platform-agnostic enterprise CLI, adopting stricter architectural boundaries will ensure long-term maintainability.

### 1. Hexagonal Architecture (Ports & Adapters)

- **Explicit Port Interfaces:** Replace inline types like `Pick<GitAdapter, ...>` in `src/core/command-context.ts` with pure interfaces defined in a `src/core/ports/` directory (e.g., `IGitProvider`, `IGitHubProvider`). Core should **only** depend on these interfaces.
- **Dependency Inversion:** This allows swapping out implementations (e.g., `MockGitProvider`, `InMemoryFileSystem`) for testing without hitting the disk, eliminating the need to clean up `/tmp` folders in unit tests.
- **Abstract the File System:** Move `src/utils/fs.ts` (direct `node:fs` usage) behind an `IFileSystem` interface injected into the context.

### 2. Disambiguate "Commands" (Use-Case Driven Design)

- **Rename Core Commands:** The distinction between `src/cli/commands` and `src/core/commands` is confusing. Rename `src/core/commands` to `src/core/use-cases` or `src/core/workflows`.
- **Separation of Concerns:** A "Command" in `src/cli` should strictly handle routing, argument parsing, and stdin/stdout. A "Use Case" in `src/core` should handle pure business logic (`SyncWorkspaceUseCase`, `BootstrapRepositoryUseCase`).

### 3. Presentation Layer & Rendering

- **Extract a Renderer/Presenter:** `src/cli/main.ts` directly uses `process.stdout.write(JSON.stringify(report))`. Core use cases should return pure DTOs (Domain Transfer Objects) or Result objects.
- **Pluggable Output:** The CLI layer should invoke a `JsonRenderer` or `InteractiveConsoleRenderer` based on flags. This separates _what_ is computed from _how_ it is displayed, allowing you to easily add interactive spinners (e.g., `clack` or `ora`) without polluting core logic.
- **Progress Reporting Abstraction:** Inject an `IObserver` or `IReporter` into `CommandContext` so core operations can emit progress events (`RepositoryCloned`, `PackResolved`) that the CLI layer can subscribe to for interactive feedback.

### 4. Deterministic Error Handling (Result Monad)

- **Error Code Registry:** `MaestroError` accepts a string `code`. Introduce a strict TypeScript Enum or String Union for Error Codes (e.g., `MaestroErrorCode = 'WORKSPACE_NOT_FOUND' | 'GIT_UNCOMMITTED_CHANGES'`). This prevents typos and enables exhaustiveness checking.
- **Result Types:** Consider returning a Result Monad (e.g., using `neverthrow` or a custom `Result<T, E>`) for expected domain errors instead of throwing exceptions. Reserve `throw` statements strictly for unexpected, unrecoverable panics.

### 5. Configuration & Dependency Injection

- **Centralize Configuration:** Magic numbers like `RESOLUTION_CONCURRENCY_LIMIT = 4` in `src/core/workspace-service.ts` should be lifted into an `AppConfig` interface injected at startup, potentially defaulting to `os.cpus().length`.
- **Application Context Builder:** Instead of manually creating and passing `CommandContext` down the chain, consider a lightweight DI container or a robust context builder at the CLI entry point.

### 6. Domain Model Extraction

- **Rich Domain Models:** Currently, `src/types.ts` and `src/workspace/types.ts` define mostly plain data structures. As logic grows, consider moving towards a richer `src/domain/` layer where business entities encapsulate their own validation and invariants (e.g., a `Workspace` class that guarantees its manifest is valid).
