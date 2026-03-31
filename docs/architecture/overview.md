# Architecture

Maestro is organized into short, testable layers:

- `src/core/`: orchestration entrypoints for lifecycle commands such as `init`, `install`, `sync`, `update`, `doctor`, the nested `git` namespace, and `worktree`
- `src/core/commands/*`: concrete command implementations used by the CLI entrypoint
- `src/core/commands.ts`: compatibility command surface for direct imports/public exports; intentionally retained as a non-CLI façade and only removable in a dedicated breaking-change window
- `src/core/execution-service.ts`: execution support for repository bootstrap planning, optional DevContainer artifact projection, and task-scoped worktrees
- `src/workspace/`: split workspace pipeline modules
  - `manifest-parser.ts`: manifest includes loading, fragment normalization, and merge semantics
  - `pack-resolver.ts`: pack location/compatibility resolution
  - `agent-discovery.ts`: agent, skill, and policy discovery logic
- `src/adapters/git/`: concrete Git operations, including sparse checkout
- `src/adapters/runtimes/`: Codex, Claude Code, and OpenCode projection
- `src/validation/`: policies and the evaluation engine
- `src/utils/`: filesystem, path-safety, and serialization primitives
- `framework-packs/starter/`: the built-in starter pack shipped with the framework
- `examples/packs/`: starter pack shapes that show how agents, skills, policies, templates, and hooks are composed for a workspace baseline

`init` also writes `AGENTS.md` at the workspace root so AI agents have a local Maestro CLI map before they realign repository branches, open worktrees, or prepare PRs.
It also writes `maestro.json` as the neutral descriptor for tools that consume the workspace directory directly, and exposes `maestro.code-workspace` through the on-demand CLI command for editors that support named multi-root workspaces.
For the durable workspace contract and the authored-versus-generated boundary, the primary reference is [Workspace Manifest](../manifests/workspace.md).

The core resolves a `ResolvedWorkspace` that is the shared data structure used by `install`, `doctor`, `bootstrap`, `git`, and `worktree`.

`src/core/commands.ts` is intentionally retained as a compatibility facade for import stability and root exports, while CLI execution remains wired through `src/core/commands/*` via `src/cli/main.ts`.

## Boundary direction

Implementation work should continue to respect a few stable seams:

- orchestration should stay separate from Git execution, workspace parsing, policy evaluation, and runtime projection;
- command execution and path resolution should flow through approved safety primitives;
- shared adapters and services should be injectable through a command context rather than hidden behind global singletons;
- schema-backed runtime data should stay aligned with TypeScript types;
- concurrency-sensitive workspace state should be protected before broader parallel execution is introduced.

Those stack rules are maintained in [`technical-stack.md`](./technical-stack.md). This page should describe enduring module boundaries, not every intermediate refactor step.
